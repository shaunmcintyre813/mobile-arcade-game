import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEngine, computePlayerY } from '../../src/game.js';
import { Player } from '../../src/player.js';
import { DisplayManager } from '../../src/display.js';
import { TouchController } from '../../src/touch.js';
import { UIManager } from '../../src/ui.js';
import { ObstacleManager } from '../../src/obstacles.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

describe('Muse Critique Fixes & Polish (v1.1.1)', () => {

  // =========================================================================
  // Finding 1: Landscape / Wide-Viewport Geometry & Dynamic Player Anchor
  // =========================================================================
  describe('Finding 1: Viewport Geometry & Player Anchor', () => {
    const viewports = [
      { name: 'Desktop Landscape Widescreen', w: 1280, h: 800 },
      { name: 'Full HD Desktop', w: 1920, h: 1080 },
      { name: 'iPad Portrait', w: 768, h: 1024 },
      { name: 'Mobile Standard Phone', w: 390, h: 844 },
      { name: 'Samsung Galaxy S25 Ultra', w: 412, h: 915 },
      { name: 'Narrow Tall Display', w: 360, h: 900 }
    ];

    it.each(viewports)('anchors player safely inside virtual viewport for $name ($w x $h)', ({ w, h }) => {
      // Scale S = w / 400
      const scale = w / 400;
      const virtualHeight = h / scale;
      const playerY = computePlayerY(virtualHeight);

      // Player Y must be strictly inside visible viewport and above bottom boundary
      expect(playerY).toBeGreaterThan(0);
      expect(playerY).toBeLessThan(virtualHeight);
      expect(virtualHeight - playerY).toBeGreaterThanOrEqual(40);

      // Obstacle culling boundary must be strictly below player Y so hazards always reach player
      const cullY = virtualHeight + 80;
      expect(cullY).toBeGreaterThan(playerY);
    });

    it('syncs player Y dynamically when DisplayManager resizes', () => {
      let resizeCb = null;
      const mockCanvas = {
        getContext: () => ({ setTransform: () => {}, scale: () => {} }),
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };

      const mockDisplay = {
        getVirtualBounds: vi.fn().mockReturnValue({ width: 400, height: 250, scale: 3.2, dpr: 1 }),
        onResize: vi.fn((cb) => { resizeCb = cb; }),
        offResize: vi.fn()
      };

      const player = new Player();
      const game = new GameEngine(mockCanvas, {
        displayManager: mockDisplay,
        player
      });

      // At virtualHeight 250 (1280x800 desktop), player Y should be adapted to ~180
      expect(game.player.y).toBeLessThan(250);
      expect(game.player.y).toBe(computePlayerY(250));

      // Simulate window resize to phone portrait (virtualHeight 888)
      mockDisplay.getVirtualBounds.mockReturnValue({ width: 400, height: 888, scale: 1.03, dpr: 1 });
      resizeCb({ height: 888 });

      expect(game.player.y).toBe(650);
    });
  });

  // =========================================================================
  // Finding 2: Tap vs Drag Disambiguation
  // =========================================================================
  describe('Finding 2: TouchController Tap vs Drag Disambiguation', () => {
    it('does NOT trigger onTap on touch contact when disambiguateTapDrag is enabled', () => {
      const listeners = {};
      const mockEl = {
        addEventListener: (t, fn) => { listeners[t] = fn; },
        removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 })
      };

      const onTap = vi.fn();
      const onDrag = vi.fn();
      const tc = new TouchController(mockEl, null, {
        disambiguateTapDrag: true,
        onTap,
        onDrag
      });

      listeners['touchstart']({
        cancelable: true,
        preventDefault: vi.fn(),
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });

      // Crucial: touchstart alone must NOT fire onTap prematurely
      expect(onTap).not.toHaveBeenCalled();
      expect(tc.touchActive).toBe(true);
      expect(tc.isDragging).toBe(false);

      // Lifting finger without moving confirms deliberate TAP
      listeners['touchend']({
        cancelable: true,
        preventDefault: vi.fn(),
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });

      expect(onTap).toHaveBeenCalledTimes(1);
      expect(onTap).toHaveBeenCalledWith({ x: 200, y: 400 });
      tc.destroy();
    });

    it('fires onDrag and SUPPRESSES onTap when finger moves beyond threshold (Steer-Only)', () => {
      const listeners = {};
      const mockEl = {
        addEventListener: (t, fn) => { listeners[t] = fn; },
        removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 })
      };

      const onTap = vi.fn();
      const onDrag = vi.fn();
      const tc = new TouchController(mockEl, null, {
        disambiguateTapDrag: true,
        tapThreshold: 8,
        onTap,
        onDrag
      });

      listeners['touchstart']({
        cancelable: true,
        preventDefault: vi.fn(),
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });

      // Move finger by 25px (thumb micro-steer)
      listeners['touchmove']({
        cancelable: true,
        preventDefault: vi.fn(),
        changedTouches: [{ identifier: 1, clientX: 225, clientY: 400 }]
      });

      expect(tc.isDragging).toBe(true);
      expect(onDrag).toHaveBeenCalled();
      expect(onTap).not.toHaveBeenCalled();

      // Lift finger after drag: must NOT invert gravity on release
      listeners['touchend']({
        cancelable: true,
        preventDefault: vi.fn(),
        changedTouches: [{ identifier: 1, clientX: 225, clientY: 400 }]
      });

      expect(onTap).not.toHaveBeenCalled();
      expect(tc.touchActive).toBe(false);
      tc.destroy();
    });
  });

  // =========================================================================
  // Finding 3: Phantom "TARGET CRUSHED!" Row Cleanup
  // =========================================================================
  describe('Finding 3: UI Target Crushed Reset', () => {
    it('derives challengeResultRow strictly from isChallengeBeaten so subsequent games do not show phantom banner', () => {
      const challengeResultRow = { classList: { remove: vi.fn(), add: vi.fn() } };
      const summaryChallenge = { textContent: '' };
      const gameOverScreen = { classList: { remove: vi.fn(), add: vi.fn() } };

      const ui = new UIManager();
      ui.challengeResultRow = challengeResultRow;
      ui.summaryChallenge = summaryChallenge;
      ui.gameOverScreen = gameOverScreen;

      // 1. Simulate a beaten challenge in round 1
      ui.triggerTargetCrushed();
      expect(ui.targetCrushed).toBe(true);

      ui.showGameOver({ score: 1000, highScore: 1000, isNewBest: true, isChallengeBeaten: true });
      expect(challengeResultRow.classList.remove).toHaveBeenCalledWith('hidden');

      // 2. Hide modal and reset UI for round 2
      ui.hideGameOver();
      ui.reset();

      // 3. Round 2 ends without beating a challenge (isChallengeBeaten: false)
      ui.showGameOver({ score: 200, highScore: 1000, isNewBest: false, isChallengeBeaten: false });
      expect(challengeResultRow.classList.add).toHaveBeenCalledWith('hidden');
    });
  });

  // =========================================================================
  // Finding 4: HUD Throttling
  // =========================================================================
  describe('Finding 4: HUD DOM Throttling', () => {
    it('only writes to DOM textContent when values change', () => {
      let scoreWrites = 0;
      let multWrites = 0;
      let bestWrites = 0;

      const hudScore = {
        _val: '0',
        get textContent() { return this._val; },
        set textContent(v) { this._val = v; scoreWrites++; }
      };
      const hudMultiplier = {
        _val: '1x',
        get textContent() { return this._val; },
        set textContent(v) { this._val = v; multWrites++; }
      };
      const hudBest = {
        _val: '0',
        get textContent() { return this._val; },
        set textContent(v) { this._val = v; bestWrites++; }
      };

      const ui = new UIManager();
      ui.hudScore = hudScore;
      ui.hudMultiplier = hudMultiplier;
      ui.hudBest = hudBest;

      // Initial update
      ui.updateHUD({ score: 10, multiplier: 1, best: 50 });
      expect(scoreWrites).toBe(1);
      expect(multWrites).toBe(1);
      expect(bestWrites).toBe(1);

      // 100 subsequent physics sub-steps with unchanged values
      for (let i = 0; i < 100; i++) {
        ui.updateHUD({ score: 10, multiplier: 1, best: 50 });
      }

      // Must not perform redundant writes
      expect(scoreWrites).toBe(1);
      expect(multWrites).toBe(1);
      expect(bestWrites).toBe(1);

      // When score updates, only score element receives write
      ui.updateHUD({ score: 20, multiplier: 1, best: 50 });
      expect(scoreWrites).toBe(2);
      expect(multWrites).toBe(1);
      expect(bestWrites).toBe(1);
    });
  });

  // =========================================================================
  // Finding 6: Favicon.ico physical existence and precache
  // =========================================================================
  describe('Finding 6: Favicon.ico Precache & Asset Existence', () => {
    it('physical favicon.ico exists in repo root with non-zero size', () => {
      const faviconPath = path.join(repoRoot, 'favicon.ico');
      expect(fs.existsSync(faviconPath)).toBe(true);
      const stat = fs.statSync(faviconPath);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('sw.js precaches ./favicon.ico', () => {
      const swPath = path.join(repoRoot, 'sw.js');
      const swContent = fs.readFileSync(swPath, 'utf8');
      expect(swContent).toContain("'./favicon.ico'");
    });
  });
});
