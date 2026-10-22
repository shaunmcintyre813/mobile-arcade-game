import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DisplayManager } from '../../src/display.js';
import { TouchController } from '../../src/touch.js';
import { Player, RAIL_LEFT, RAIL_RIGHT, RAIL_X_LEFT, RAIL_X_RIGHT } from '../../src/player.js';
import { ObstacleManager } from '../../src/obstacles.js';
import { ScoreManager, StorageController, STORAGE_KEY } from '../../src/score.js';
import { ShareController, sanitizeChallengerName, parseChallengeParams } from '../../src/share.js';
import { UIManager } from '../../src/ui.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { setupFullE2EEnvironment, createMockCanvas } from '../fixtures/e2e_harness.js';

describe('Tier 2: Boundary & Corner Cases (Opaque-Box E2E)', () => {
  let env;

  beforeEach(() => {
    env = setupFullE2EEnvironment();
  });

  afterEach(() => {
    if (env) {
      env.cleanup();
    }
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Extreme Aspect Ratios & Dimension Boundaries
  // =========================================================================
  describe('1. Extreme Aspect Ratios & Dimension Boundaries', () => {
    it('1.1 20:9 tall aspect ratio (412x915) maintains fixed virtual width 400 and dynamic height approx 888.35', () => {
      const canvas = createMockCanvas(412, 915);
      env.window.innerWidth = 412;
      env.window.innerHeight = 915;

      const display = new DisplayManager(canvas);
      const bounds = display.getVirtualBounds();

      expect(bounds.width).toBe(400);
      expect(bounds.height).toBeCloseTo(400 * (915 / 412), 2);
      expect(Number.isFinite(bounds.height)).toBe(true);
      expect(bounds.scale).toBeCloseTo(412 / 400, 4);
    });

    it('1.2 1:1 square screen ratio (600x600) produces virtual bounds of exactly 400x400', () => {
      const canvas = createMockCanvas(600, 600);
      env.window.innerWidth = 600;
      env.window.innerHeight = 600;

      const display = new DisplayManager(canvas);
      const bounds = display.getVirtualBounds();

      expect(bounds.width).toBe(400);
      expect(bounds.height).toBe(400);
      expect(bounds.scale).toBe(1.5);
    });

    it('1.3 1:20 extreme ultra-tall ratio (100x2000) computes without NaN or divide-by-zero', () => {
      const canvas = createMockCanvas(100, 2000);
      env.window.innerWidth = 100;
      env.window.innerHeight = 2000;

      const display = new DisplayManager(canvas);
      const bounds = display.getVirtualBounds();

      expect(bounds.width).toBe(400);
      expect(bounds.height).toBe(8000);
      expect(bounds.scale).toBe(0.25);
      expect(Number.isFinite(bounds.scale)).toBe(true);
    });

    it('1.4 20:1 extreme ultra-wide landscape ratio (2000x100) computes bounded virtual height', () => {
      const canvas = createMockCanvas(2000, 100);
      env.window.innerWidth = 2000;
      env.window.innerHeight = 100;

      const display = new DisplayManager(canvas);
      const bounds = display.getVirtualBounds();

      expect(bounds.width).toBe(400);
      expect(bounds.height).toBe(20);
      expect(bounds.scale).toBe(5.0);
    });

    it('1.5 Zero or negative dimensions handled safely without crash or NaN', () => {
      const canvas = createMockCanvas(0, 0);
      env.window.innerWidth = 0;
      env.window.innerHeight = 0;

      expect(() => {
        const display = new DisplayManager(canvas);
        const bounds = display.getVirtualBounds();
        expect(Number.isFinite(bounds.width)).toBe(true);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 2. Rapid Touch Bursts & Gesture Fuzzing
  // =========================================================================
  describe('2. Rapid Touch Bursts & Gesture Fuzzing', () => {
    it('2.1 High-frequency touch spam (50 events in rapid succession) preserves entity stability without NaN', () => {
      const canvas = env.canvas;
      const game = new GameEngine(canvas);
      game.startPlaying();

      // Dispatch 50 rapid alternating taps and moves
      for (let i = 0; i < 50; i++) {
        canvas.dispatchCanvasEvent('touchstart', {
          touches: [{ identifier: 1, clientX: 100 + (i % 20), clientY: 200 + (i % 20) }],
          changedTouches: [{ identifier: 1, clientX: 100 + (i % 20), clientY: 200 + (i % 20) }]
        });
        canvas.dispatchCanvasEvent('touchmove', {
          touches: [{ identifier: 1, clientX: 110 + (i % 20), clientY: 200 + (i % 20) }],
          changedTouches: [{ identifier: 1, clientX: 110 + (i % 20), clientY: 200 + (i % 20) }]
        });
        canvas.dispatchCanvasEvent('touchend', {
          touches: [],
          changedTouches: [{ identifier: 1, clientX: 110 + (i % 20), clientY: 200 + (i % 20) }]
        });
      }

      // Assert player coordinates and state remain strictly valid numbers
      expect(Number.isFinite(game.player.x)).toBe(true);
      expect(Number.isFinite(game.player.y)).toBe(true);
      expect(!Number.isNaN(game.player.x)).toBe(true);
      expect(!Number.isNaN(game.player.y)).toBe(true);
      expect(game.player.x).toBeGreaterThanOrEqual(0);
      expect(game.player.x).toBeLessThanOrEqual(400);
    });

    it('2.2 Extreme drag coordinates outside canvas (x=-5000, x=10000) keep player within virtual bounds', () => {
      const player = new Player();
      const extremeDeltas = [-5000, 10000, -99999, 888888];

      for (const d of extremeDeltas) {
        player.applyMicroDrag(d);
        expect(player.x).toBeGreaterThanOrEqual(RAIL_X_LEFT - 40);
        expect(player.x).toBeLessThanOrEqual(RAIL_X_RIGHT + 40);
      }
    });

    it('2.3 Rapid alternating gravity flip taps across consecutive sub-steps never produce infinite velocity', () => {
      const player = new Player();

      for (let i = 0; i < 20; i++) {
        player.flipGravity();
        player.update(1 / 120);
        expect(Number.isFinite(player.vx)).toBe(true);
        expect(Number.isFinite(player.x)).toBe(true);
      }
    });

    it('2.4 Multi-finger simultaneous touches: 5 simultaneous fingers ignore secondary fingers', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      let tapCount = 0;
      let dragCount = 0;

      const touch = new TouchController(canvas, display, {
        onTap: () => tapCount++,
        onDrag: () => dragCount++
      });

      // Finger 1 touches down
      canvas.dispatchCanvasEvent('touchstart', {
        touches: [{ identifier: 1, clientX: 100, clientY: 300 }],
        changedTouches: [{ identifier: 1, clientX: 100, clientY: 300 }]
      });

      // Fingers 2, 3, 4, 5 touch down simultaneously
      for (let id = 2; id <= 5; id++) {
        canvas.dispatchCanvasEvent('touchstart', {
          touches: [
            { identifier: 1, clientX: 100, clientY: 300 },
            { identifier: id, clientX: id * 50, clientY: 300 }
          ],
          changedTouches: [{ identifier: id, clientX: id * 50, clientY: 300 }]
        });
      }

      // Move fingers 2 through 5
      for (let id = 2; id <= 5; id++) {
        canvas.dispatchCanvasEvent('touchmove', {
          touches: [
            { identifier: 1, clientX: 100, clientY: 300 },
            { identifier: id, clientX: id * 50 + 20, clientY: 300 }
          ],
          changedTouches: [{ identifier: id, clientX: id * 50 + 20, clientY: 300 }]
        });
      }

      expect(dragCount).toBe(0); // Only finger 1 can drag
      touch.destroy();
    });
  });

  // =========================================================================
  // 3. Storage Limits & Corruption Resilience
  // =========================================================================
  describe('3. Storage Limits & Corruption Resilience', () => {
    it('3.1 QuotaExceededError in localStorage falls back to in-memory score without exception', () => {
      env.storage._setQuotaExceeded(true);
      const storage = new StorageController();

      expect(() => storage.saveHighScore(3500)).not.toThrow();
      expect(storage.getHighScore()).toBe(3500);
    });

    it('3.2 Giant corrupted 100KB garbage string in localStorage safely sanitizes to 0', () => {
      const hugeGarbage = 'X'.repeat(100 * 1024);
      env.storage._getRawStore().set(STORAGE_KEY, hugeGarbage);

      const storage = new StorageController();
      expect(storage.getHighScore()).toBe(0);
    });

    it('3.3 Negative numbers in localStorage are sanitized safely to 0', () => {
      const negatives = ['-1', '-500', '-9999999'];
      const storage = new StorageController();

      for (const neg of negatives) {
        env.storage._getRawStore().set(STORAGE_KEY, neg);
        expect(storage.getHighScore()).toBe(0);
      }
    });

    it('3.4 Floating point string numbers parse cleanly as integers without decimal distortion', () => {
      env.storage._getRawStore().set(STORAGE_KEY, '4567.89');
      const storage = new StorageController();
      expect(storage.getHighScore()).toBe(4567);
    });
  });

  // =========================================================================
  // 4. Malformed Challenge Query Parameters
  // =========================================================================
  describe('4. Malformed Challenge Query Parameters', () => {
    it('4.1 Negative target scores (?c=-50, ?c=-99999) are rejected with hasChallenge: false', () => {
      const badQueries = ['?c=-50', '?c=-99999&by=Hacker', '?score=-10'];

      for (const q of badQueries) {
        const res = ShareController.parseChallenge(q);
        expect(res.hasChallenge).toBe(false);
        expect(res.targetScore).toBeNull();
      }
    });

    it('4.2 Non-numeric strings (?c=abc, ?c=NaN, ?c=undefined) are rejected safely', () => {
      const nanQueries = ['?c=abc', '?c=NaN', '?c=undefined', '?c=12a34', '?score=invalid'];

      for (const q of nanQueries) {
        const res = ShareController.parseChallenge(q);
        expect(res.hasChallenge).toBe(false);
        expect(res.targetScore).toBeNull();
      }
    });

    it('4.3 Extreme integer overflow (> 9,999,999) is rejected safely', () => {
      const overflowQueries = [
        '?c=99999999999999999999999999',
        '?c=10000000',
        '?score=999999999'
      ];

      for (const q of overflowQueries) {
        const res = ShareController.parseChallenge(q);
        expect(res.hasChallenge).toBe(false);
        expect(res.targetScore).toBeNull();
      }
    });

    it('4.4 Target score of zero (?c=0) is rejected as non-challenge', () => {
      const res = ShareController.parseChallenge('?c=0');
      expect(res.hasChallenge).toBe(false);
      expect(res.targetScore).toBeNull();
    });

    it('4.5 XSS payloads in challenger name are sanitized and HTML tags stripped', () => {
      const xssQueries = [
        '?c=500&by=<svg/onload=alert(1)>',
        '?c=500&by=<script>window.location="http://evil.com"</script>',
        '?c=500&by="><script>alert(1)</script>'
      ];

      for (const q of xssQueries) {
        const res = ShareController.parseChallenge(q);
        expect(res.hasChallenge).toBe(true);
        expect(res.challengerName).not.toContain('<script');
        expect(res.challengerName).not.toContain('<svg');
        expect(res.challengerName).not.toContain('onload');
      }
    });

    it('4.6 Empty, blank, or missing query parameters return hasChallenge: false without throwing', () => {
      const emptyQueries = ['', '?', '?c=', '?by=Alex', '???', '   '];

      for (const q of emptyQueries) {
        expect(() => {
          const res = ShareController.parseChallenge(q);
          expect(res.hasChallenge).toBe(false);
        }).not.toThrow();
      }
    });
  });

  // =========================================================================
  // 5. Immediate Frame-0 Death & Score Ties
  // =========================================================================
  describe('5. Immediate Frame-0 Death & Score Ties', () => {
    it('5.1 Immediate frame-0 death at score 0 handles game-over screen cleanly without NaN or broken UI', () => {
      const canvas = env.canvas;
      const game = new GameEngine(canvas);
      game.startPlaying();

      // Lethal collision at score 0
      game.triggerGameOver({ x: 50, y: 700 });

      expect(game.state).toBe(STATE_GAME_OVER);
      expect(game.score).toBe(0);
      expect(env.elements['game-over-screen'].classList.contains('hidden')).toBe(false);
      expect(env.elements['game-over-score'].textContent).toBe('0');
      expect(!Number.isNaN(game.highScore)).toBe(true);
    });

    it('5.2 Score tie with high score (e.g. 850 vs 850) does not falsely trigger new record celebration', () => {
      const storage = new StorageController();
      storage.saveHighScore(850);

      const scoreManager = new ScoreManager({ storageController: storage });
      scoreManager.score = 850;

      const isNewBest = scoreManager.saveHighScore();
      expect(isNewBest).toBe(false);
      expect(scoreManager.isNewHighScore).toBe(false);
      expect(scoreManager.highScore).toBe(850);
    });

    it('5.3 Ultra-high score values (e.g. 1,234,567) format without DOM text truncation', () => {
      const ui = new UIManager();
      ui.showChallengeBanner({ targetScore: 1234567, challengerName: 'Speedster' });

      expect(env.elements['challenge-text'].textContent).toContain('1,234,567');
      expect(env.elements['challenge-text'].textContent).toContain('Speedster');
    });
  });
});
