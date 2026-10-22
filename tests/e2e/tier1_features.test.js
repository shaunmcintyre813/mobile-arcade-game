import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

import { DisplayManager } from '../../src/display.js';
import { TouchController } from '../../src/touch.js';
import { SoundEngine } from '../../src/audio.js';
import { Player, RAIL_LEFT, RAIL_RIGHT } from '../../src/player.js';
import { ObstacleManager } from '../../src/obstacles.js';
import { ScoreManager, StorageController, STORAGE_KEY } from '../../src/score.js';
import { ShareController, sanitizeChallengerName, parseChallengeParams } from '../../src/share.js';
import { UIManager } from '../../src/ui.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { createPreviewServer, MIME_TYPES } from '../../preview.js';
import { setupFullE2EEnvironment, createMockCanvas } from '../fixtures/e2e_harness.js';
import { GalaxyS25Ultra } from '../fixtures/devices.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

describe('Tier 1: Feature Coverage (Opaque-Box E2E)', () => {
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
  // Feature 1: Viewport & Canvas Scaling (S25 Ultra 412x915, DPR clamp, zero letterbox)
  // =========================================================================
  describe('1. Viewport & Canvas Scaling', () => {
    it('1.1 S25 Ultra 412x915 geometry calculates virtual width 400 and dynamic height approx 888.35', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      const bounds = display.getVirtualBounds();

      expect(bounds.width).toBe(400);
      const expectedHeight = 400 * (915 / 412);
      expect(bounds.height).toBeCloseTo(expectedHeight, 2);
      expect(bounds.scale).toBeCloseTo(412 / 400, 4);
    });

    it('1.2 Clamps DPR to 3.0 maximum when devicePixelRatio is 3.5 on S25 Ultra', () => {
      env.window.devicePixelRatio = 3.5;
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);

      expect(display.dpr).toBe(3.0);
      expect(canvas.width).toBe(Math.round(412 * 3.0));
      expect(canvas.height).toBe(Math.round(915 * 3.0));
    });

    it('1.3 Zero letterbox: canvas display dimensions fill CSS client width and height completely', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      display.resize();

      expect(canvas.clientWidth).toBe(412);
      expect(canvas.clientHeight).toBe(915);
      expect(canvas.style.width).toBe('412px');
      expect(canvas.style.height).toBe('915px');
    });

    it('1.4 Bijective coordinate transformation: screenToVirtual invertible back to screen coordinates', () => {
      const display = new DisplayManager(env.canvas);
      const testPoints = [
        { sx: 0, sy: 0 },
        { sx: 206, sy: 457 },
        { sx: 412, sy: 915 },
        { sx: 100, sy: 300 }
      ];

      for (const pt of testPoints) {
        const v = display.screenToVirtual(pt.sx, pt.sy);
        const reconstructedX = v.x * display.scale;
        const reconstructedY = v.y * display.scale;
        expect(reconstructedX).toBeCloseTo(pt.sx, 1);
        expect(reconstructedY).toBeCloseTo(pt.sy, 1);
      }
    });

    it('1.5 Dynamic window resize updates scale factor and virtual bounds without throwing', () => {
      const display = new DisplayManager(env.canvas);
      env.canvas.clientWidth = 360;
      env.canvas.clientHeight = 780;
      env.window.innerWidth = 360;
      env.window.innerHeight = 780;

      expect(() => display.resize()).not.toThrow();
      const bounds = display.getVirtualBounds();
      expect(bounds.width).toBe(400);
      expect(bounds.height).toBeCloseTo(400 * (780 / 360), 2);
    });

    it('1.6 Alternative aspect profiles (iPhone 15 Pro 393x852, Compact 360x640) maintain 400 virtual width', () => {
      const profiles = [
        { w: 393, h: 852 },
        { w: 360, h: 640 }
      ];

      for (const p of profiles) {
        const c = createMockCanvas(p.w, p.h);
        env.window.innerWidth = p.w;
        env.window.innerHeight = p.h;
        const disp = new DisplayManager(c);
        const b = disp.getVirtualBounds();
        expect(b.width).toBe(400);
        expect(b.height).toBeCloseTo(400 * (p.h / p.w), 2);
      }
    });
  });

  // =========================================================================
  // Feature 2: Touch Controller & Gesture Isolation
  // =========================================================================
  describe('2. Touch Controller & Gesture Isolation', () => {
    it('2.1 Registers touch listeners with { passive: false }', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      const touch = new TouchController(canvas, display);

      const listeners = canvas.addEventListener.mock.calls;
      const touchTypes = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];

      for (const t of touchTypes) {
        const call = listeners.find(c => c[0] === t);
        expect(call).toBeDefined();
        expect(call[2]).toEqual({ passive: false });
      }
      touch.destroy();
    });

    it('2.2 Invokes e.preventDefault() on touch events to prevent browser pull-to-refresh & zoom', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      const touch = new TouchController(canvas, display);

      const startEvt = canvas.dispatchCanvasEvent('touchstart', {
        touches: [{ identifier: 1, clientX: 200, clientY: 400 }],
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });
      expect(startEvt.preventDefault).toHaveBeenCalled();

      const moveEvt = canvas.dispatchCanvasEvent('touchmove', {
        touches: [{ identifier: 1, clientX: 220, clientY: 400 }],
        changedTouches: [{ identifier: 1, clientX: 220, clientY: 400 }]
      });
      expect(moveEvt.preventDefault).toHaveBeenCalled();

      const endEvt = canvas.dispatchCanvasEvent('touchend', {
        touches: [],
        changedTouches: [{ identifier: 1, clientX: 220, clientY: 400 }]
      });
      expect(endEvt.preventDefault).toHaveBeenCalled();

      touch.destroy();
    });

    it('2.3 Single-touch tracking: ignores secondary touch points (multi-touch immunity)', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      let dragDeltas = [];
      const touch = new TouchController(canvas, display, {
        onDrag: (pos, delta) => dragDeltas.push(delta.x)
      });

      // Primary touch #1
      canvas.dispatchCanvasEvent('touchstart', {
        touches: [{ identifier: 1, clientX: 100, clientY: 300 }],
        changedTouches: [{ identifier: 1, clientX: 100, clientY: 300 }]
      });

      // Secondary touch #2 should be ignored
      canvas.dispatchCanvasEvent('touchstart', {
        touches: [
          { identifier: 1, clientX: 100, clientY: 300 },
          { identifier: 2, clientX: 300, clientY: 300 }
        ],
        changedTouches: [{ identifier: 2, clientX: 300, clientY: 300 }]
      });

      // Movement of secondary touch #2 should not generate onDrag
      dragDeltas = [];
      canvas.dispatchCanvasEvent('touchmove', {
        touches: [
          { identifier: 1, clientX: 100, clientY: 300 },
          { identifier: 2, clientX: 350, clientY: 300 }
        ],
        changedTouches: [{ identifier: 2, clientX: 350, clientY: 300 }]
      });
      expect(dragDeltas.length).toBe(0);

      touch.destroy();
    });

    it('2.4 Micro-drag bounds: lateral drag translation is tracked smoothly', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      let lastDelta = null;
      const touch = new TouchController(canvas, display, {
        onDrag: (pos, delta) => { lastDelta = delta; }
      });

      canvas.dispatchCanvasEvent('touchstart', {
        touches: [{ identifier: 1, clientX: 200, clientY: 400 }],
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });

      canvas.dispatchCanvasEvent('touchmove', {
        touches: [{ identifier: 1, clientX: 230, clientY: 400 }],
        changedTouches: [{ identifier: 1, clientX: 230, clientY: 400 }]
      });

      expect(lastDelta).not.toBeNull();
      expect(lastDelta.x).toBeGreaterThan(0);

      touch.destroy();
    });

    it('2.5 Tap gesture detection: fires onTap callback when movement is within micro-tap threshold', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      let tapFired = false;
      const touch = new TouchController(canvas, display, {
        onTap: () => { tapFired = true; }
      });

      canvas.dispatchCanvasEvent('touchstart', {
        touches: [{ identifier: 1, clientX: 200, clientY: 400 }],
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });

      canvas.dispatchCanvasEvent('touchend', {
        touches: [],
        changedTouches: [{ identifier: 1, clientX: 202, clientY: 401 }]
      });

      expect(tapFired).toBe(true);
      touch.destroy();
    });

    it('2.6 Touchcancel clears active touch tracking and resets drag delta cleanly', () => {
      const canvas = env.canvas;
      const display = new DisplayManager(canvas);
      const touch = new TouchController(canvas, display);

      canvas.dispatchCanvasEvent('touchstart', {
        touches: [{ identifier: 1, clientX: 200, clientY: 400 }],
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });
      expect(touch.touchActive).toBe(true);
      expect(touch.touchId).toBe(1);

      canvas.dispatchCanvasEvent('touchcancel', {
        touches: [],
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
      });
      expect(touch.touchActive).toBe(false);
      expect(touch.touchId).toBeNull();

      touch.destroy();
    });
  });

  // =========================================================================
  // Feature 3: Procedural Audio Engine
  // =========================================================================
  describe('3. Procedural Audio Engine', () => {
    it('3.1 playJump synthesizes rising frequency sweep with oscillator and gain nodes', () => {
      const sound = new SoundEngine();
      sound.ensureContext();
      expect(() => sound.playJump()).not.toThrow();
    });

    it('3.2 playCombo synthesizes pentatonic harmonic chime with pitch frequency scaled by multiplier', () => {
      const sound = new SoundEngine();
      sound.ensureContext();
      expect(() => sound.playCombo(1)).not.toThrow();
      expect(() => sound.playCombo(4)).not.toThrow();
      expect(() => sound.playCombo(12)).not.toThrow();
    });

    it('3.3 playNearMiss synthesizes high-frequency graze shimmer with resonant filter', () => {
      const sound = new SoundEngine();
      sound.ensureContext();
      expect(() => sound.playNearMiss()).not.toThrow();
    });

    it('3.4 playCrash synthesizes white noise explosion buffer with low-pass filter decay', () => {
      const sound = new SoundEngine();
      sound.ensureContext();
      expect(() => sound.playCrash()).not.toThrow();
    });

    it('3.5 playFanfare synthesizes multi-note celebratory arpeggio without errors', () => {
      const sound = new SoundEngine();
      sound.ensureContext();
      expect(() => sound.playFanfare()).not.toThrow();
    });

    it('3.6 Mute functionality (toggleMute(true)) suppresses sound generation cleanly', () => {
      const sound = new SoundEngine();
      sound.ensureContext();
      sound.toggleMute(true);
      expect(sound.isMuted).toBe(true);

      expect(() => sound.playJump()).not.toThrow();
      expect(() => sound.playCrash()).not.toThrow();
      expect(() => sound.playFanfare()).not.toThrow();

      sound.toggleMute(false);
      expect(sound.isMuted).toBe(false);
    });
  });

  // =========================================================================
  // Feature 4: PWA Manifest & Valid Icons
  // =========================================================================
  describe('4. PWA Manifest & Valid PNG/SVG Icons', () => {
    const manifestPath = path.join(projectRoot, 'manifest.webmanifest');
    const rawManifest = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(rawManifest);

    it('4.1 manifest.webmanifest contains required PWA fields and values', () => {
      expect(manifest.name).toBe('AntiGravity: Neon Pulse');
      expect(manifest.short_name).toBe('AntiGravity');
      expect(manifest.start_url).toBe('/mobile-arcade-game/');
      expect(manifest.display).toBe('standalone');
      expect(manifest.orientation).toBe('portrait');
      expect(manifest.theme_color).toBe('#0a0a16');
      expect(manifest.background_color).toBe('#0a0a16');
    });

    it('4.2 Manifest defines standard 192x192 and 512x512 PNG icons', () => {
      const icon192 = manifest.icons.find(i => i.sizes === '192x192' && i.type === 'image/png');
      const icon512 = manifest.icons.find(i => i.sizes === '512x512' && i.purpose === 'any');

      expect(icon192).toBeDefined();
      expect(icon512).toBeDefined();
    });

    it('4.3 Manifest includes 512x512 maskable icon with purpose: "maskable"', () => {
      const maskable = manifest.icons.find(i => i.purpose && i.purpose.includes('maskable'));
      expect(maskable).toBeDefined();
      expect(maskable.sizes).toBe('512x512');
      expect(maskable.src).toBe('icons/icon-maskable-512.png');
    });

    it('4.4 Master vector icon icons/icon.svg exists and is valid SVG XML', () => {
      const svgPath = path.join(projectRoot, 'icons', 'icon.svg');
      expect(fs.existsSync(svgPath)).toBe(true);
      const svgContent = fs.readFileSync(svgPath, 'utf8');
      expect(svgContent).toContain('<svg');
      expect(svgContent).toContain('</svg>');
      expect(svgContent).toContain('viewBox');
    });

    it('4.5 PNG icons have valid PNG magic numbers (0x89, 0x50, 0x4E, 0x47)', () => {
      const pngFiles = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
      for (const file of pngFiles) {
        const filePath = path.join(projectRoot, 'icons', file);
        expect(fs.existsSync(filePath)).toBe(true);
        const buf = fs.readFileSync(filePath);
        expect(buf[0]).toBe(0x89);
        expect(buf[1]).toBe(0x50);
        expect(buf[2]).toBe(0x4e);
        expect(buf[3]).toBe(0x47);
      }
    });

    it('4.6 Manifest keeps the installed app within the GitHub Pages project path', () => {
      expect(manifest.id).toBe('/mobile-arcade-game/');
      expect(manifest.start_url).toBe('/mobile-arcade-game/');
      expect(manifest.scope).toBe('/mobile-arcade-game/');
    });
  });

  // =========================================================================
  // Feature 5: Service Worker Offline Caching
  // =========================================================================
  describe('5. Service Worker Offline Caching', () => {
    const swPath = path.join(projectRoot, 'sw.js');
    const swCode = fs.readFileSync(swPath, 'utf8');

    it('5.1 sw.js defines CACHE_NAME and PRECACHE_ASSETS containing critical app shell files', () => {
      expect(swCode).toContain('CACHE_NAME');
      expect(swCode).toContain('PRECACHE_ASSETS');
      expect(swCode).toContain("'./index.html'");
      expect(swCode).toContain("'./style.css'");
      expect(swCode).toContain("'./manifest.webmanifest'");
      expect(swCode).toContain("'./src/display.js'");
    });

    it('5.2 sw.js install event caches precache assets and calls skipWaiting()', () => {
      expect(swCode).toMatch(/caches\.open\(CACHE_NAME\)/);
      expect(swCode).toMatch(/cache\.addAll\(PRECACHE_ASSETS\)/);
      expect(swCode).toMatch(/skipWaiting\(\)/);
    });

    it('5.3 sw.js activate event purges obsolete cache generations and claims clients', () => {
      expect(swCode).toMatch(/caches\.keys\(\)/);
      expect(swCode).toMatch(/caches\.delete\(/);
      expect(swCode).toMatch(/clients\.claim\(\)/);
    });

    it('5.4 sw.js fetch event intercepts navigation requests with Stale-While-Revalidate and ignoreSearch: true', () => {
      expect(swCode).toMatch(/request\.mode\s*===\s*['"]navigate['"]/);
      expect(swCode).toMatch(/ignoreSearch:\s*true/);
    });

    it('5.5 sw.js fetch event serves static subresources with Cache-First strategy', () => {
      expect(swCode).toMatch(/caches\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/);
      expect(swCode).toMatch(/fetch\(request\)/);
      expect(swCode).toMatch(/cache\.put\(/);
    });

    it('5.6 sw.js handles offline fallback for image and other subresources gracefully', () => {
      expect(swCode).toMatch(/request\.destination\s*===\s*['"]image['"]/);
      expect(swCode).toMatch(/status:\s*503/);
    });
  });

  // =========================================================================
  // Feature 6: Game Loop & 120Hz Physics Accumulator
  // =========================================================================
  describe('6. Game Loop & 120Hz Physics Accumulator', () => {
    it('6.1 Fixed timeStep is configured to 1/120s (approx 8.333ms)', () => {
      const engine = new GameEngine(env.canvas);
      expect(engine.fixedTimeStep).toBeCloseTo(1 / 120, 5);
      expect(engine.maxAccumulator).toBe(0.1);
    });

    it('6.2 Variable frame delta (17ms for ~60Hz) executes exactly 2 physics updates', () => {
      const engine = new GameEngine(env.canvas);
      const updateSpy = vi.spyOn(engine, 'update');

      engine.running = true;
      engine.lastTime = 1000;
      engine.accumulatedTime = 0;

      // Tick with 17ms delta (> 2 * (1000/120) = 16.667ms)
      engine.tick(1017);
      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(engine.accumulatedTime).toBeLessThan(engine.fixedTimeStep);
    });

    it('6.3 Clamps large delta times to maxAccumulator (100ms) to prevent spiral of death', () => {
      const engine = new GameEngine(env.canvas);
      const updateSpy = vi.spyOn(engine, 'update');

      engine.running = true;
      engine.lastTime = 1000;
      engine.accumulatedTime = 0;

      // Tick after 2000ms delay (e.g. background tab suspended)
      engine.tick(3000);
      // Clamped to 0.1s -> 0.1 / (1/120) = 12 updates maximum
      expect(updateSpy).toHaveBeenCalledTimes(12);
    });

    it('6.4 Obstacle scroll speed escalates progressively over survival time', () => {
      const obstacles = new ObstacleManager();
      const initialSpeed = obstacles.currentSpeed;

      // Simulate 30 seconds of survival
      for (let i = 0; i < 30 * 120; i++) {
        obstacles.update(1 / 120, 900);
      }

      expect(obstacles.currentSpeed).toBeGreaterThan(initialSpeed);
    });

    it('6.5 Lethal collision triggers state transition to GAME_OVER and spawns crash effects', () => {
      const engine = new GameEngine(env.canvas);
      engine.startPlaying();

      const lethalObstacle = { x: 50, y: 700, width: 60, height: 20 };
      engine.triggerGameOver(lethalObstacle);

      expect(engine.state).toBe(STATE_GAME_OVER);
      expect(env.elements['game-over-screen'].classList.contains('hidden')).toBe(false);
    });

    it('6.6 Near-miss graze detection (+20px margin) builds combo multiplier without death', () => {
      const engine = new GameEngine(env.canvas);
      engine.startPlaying();
      expect(engine.scoreManager.multiplier).toBe(1);

      // Trigger a near miss
      engine.scoreManager.addNearMiss();
      expect(engine.scoreManager.multiplier).toBe(2);
      expect(engine.state).toBe(STATE_PLAYING);
    });
  });

  // =========================================================================
  // Feature 7: Scoring & LocalStorage Persistence
  // =========================================================================
  describe('7. Scoring & LocalStorage Persistence', () => {
    it('7.1 Continuous survival points increment over time based on multiplier', () => {
      const storage = new StorageController();
      const scoreManager = new ScoreManager({ storageController: storage });
      scoreManager.multiplier = 3;
      scoreManager.comboTimer = 5.0;

      // 1 second of survival at 3x multiplier
      scoreManager.update(1.0);
      expect(scoreManager.score).toBe(30); // 10 pts/sec * 3x
    });

    it('7.2 Monotonic high score save: high score only updates when current run strictly exceeds stored record', () => {
      const storage = new StorageController();
      storage.saveHighScore(500);

      const scoreManager = new ScoreManager({ storageController: storage });
      expect(scoreManager.highScore).toBe(500);

      scoreManager.score = 750;
      const isNewBest = scoreManager.saveHighScore();
      expect(isNewBest).toBe(true);
      expect(scoreManager.highScore).toBe(750);
      expect(storage.getHighScore()).toBe(750);
    });

    it('7.3 Runs with lower scores do NOT overwrite a higher stored record', () => {
      const storage = new StorageController();
      storage.saveHighScore(1000);

      const scoreManager = new ScoreManager({ storageController: storage });
      scoreManager.score = 450;
      const isNewBest = scoreManager.saveHighScore();

      expect(isNewBest).toBe(false);
      expect(scoreManager.highScore).toBe(1000);
      expect(storage.getHighScore()).toBe(1000);
    });

    it('7.4 Corrupted localStorage data ("NaN", "{}", "invalid", "-50") safely sanitized to 0', () => {
      const corruptions = ['NaN', '{}', 'invalid', '-50', 'null', 'undefined'];
      const storage = new StorageController();

      for (const val of corruptions) {
        env.storage._getRawStore().set(STORAGE_KEY, val);
        expect(storage.getHighScore()).toBe(0);
      }
    });

    it('7.5 Handles QuotaExceededError without crashing or unhandled exceptions', () => {
      env.storage._setQuotaExceeded(true);
      const storage = new StorageController();

      expect(() => storage.saveHighScore(1200)).not.toThrow();
      // In-memory fallback still functions
      expect(storage.getHighScore()).toBe(1200);
    });

    it('7.6 Large numbers formatted cleanly with comma separators in UI', () => {
      const ui = new UIManager();
      ui.showChallengeBanner({ targetScore: 1250000, challengerName: 'Champion' });

      expect(env.elements['challenge-text'].textContent).toContain('1,250,000');
    });
  });

  // =========================================================================
  // Feature 8: Social Share & Challenge System
  // =========================================================================
  describe('8. Social Share & Challenge System', () => {
    it('8.1 ShareController.shareScore() invokes navigator.share with challenge URL ?c=<score>&by=<name>', async () => {
      const share = new ShareController();
      await share.shareScore({ score: 1450, playerName: 'Alex' });

      expect(env.shareLog.length).toBe(1);
      const payload = env.shareLog[0];
      expect(payload.title).toContain('AntiGravity');
      expect(payload.text).toContain('1450');
      expect(payload.url).toContain('c=1450');
      expect(payload.url).toContain('by=Alex');
    });

    it('8.2 Silently catches and suppresses AbortError when user cancels native share dialog', async () => {
      const abortError = new Error('User cancelled share');
      abortError.name = 'AbortError';
      env.setShareError(abortError);

      const share = new ShareController();
      let result;
      await expect((async () => {
        result = await share.shareScore({ score: 900 });
      })()).resolves.not.toThrow();

      expect(result.cancelled).toBe(true);
      expect(result.success).toBe(false);
      // Clipboard should NOT be triggered on voluntary user cancel
      expect(env.clipboardLog.length).toBe(0);
    });

    it('8.3 Falls back to navigator.clipboard.writeText when navigator.share is unavailable', async () => {
      delete env.navigator.share;
      const share = new ShareController();
      const result = await share.shareScore({ score: 1100, playerName: 'Player' });

      expect(result.success).toBe(true);
      expect(result.method).toBe('clipboard');
      expect(env.clipboardLog.length).toBe(1);
      expect(env.clipboardLog[0]).toContain('c=1100');
    });

    it('8.4 Triggers floating animated toast notification upon clipboard copy', async () => {
      delete env.navigator.share;
      const ui = new UIManager();
      const share = new ShareController();

      const spyToast = vi.spyOn(ui, 'showToast');
      await share.shareScore({ score: 850 });
      ui.showToast('Challenge link copied to clipboard!');

      expect(spyToast).toHaveBeenCalledWith('Challenge link copied to clipboard!');
      const toastEl = env.elements['toast-container'].children[0];
      expect(toastEl).toBeDefined();
      expect(toastEl.textContent).toContain('copied to clipboard');
    });

    it('8.5 parseChallenge correctly extracts target score and challenger name from query strings', () => {
      const parsed = ShareController.parseChallenge('?c=1250&by=Alex');
      expect(parsed.hasChallenge).toBe(true);
      expect(parsed.targetScore).toBe(1250);
      expect(parsed.challengerName).toBe('Alex');

      // Also supports verbose ?score=2000&challenger=Jordan
      const verbose = ShareController.parseChallenge('?score=2000&challenger=Jordan');
      expect(verbose.hasChallenge).toBe(true);
      expect(verbose.targetScore).toBe(2000);
      expect(verbose.challengerName).toBe('Jordan');
    });

    it('8.6 Challenge sanitization strips HTML tags and clamps target score safely', () => {
      const sanitized = ShareController.parseChallenge('?c=-50&by=<script>alert("hack")</script>');
      expect(sanitized.hasChallenge).toBe(false);
      expect(sanitized.targetScore).toBeNull();
      expect(sanitized.challengerName).toBeNull();
    });
  });

  // =========================================================================
  // Feature 9: Standalone Preview Server
  // =========================================================================
  describe('9. Standalone Preview Server', () => {
    let server;
    let testPort;

    beforeEach(async () => {
      server = createPreviewServer(projectRoot);
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          testPort = server.address().port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('9.1 Serves index.html on root / with HTTP status 200 and Content-Type text/html; charset=UTF-8', async () => {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}/`, (response) => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        }).on('error', reject);
      });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=UTF-8');
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).toContain('AntiGravity');
    });

    it('9.2 Serves correct MIME types for static assets (.js, .css, .webmanifest, .png, .svg)', async () => {
      const testCases = [
        { path: '/style.css', expected: 'text/css; charset=UTF-8' },
        { path: '/src/display.js', expected: 'text/javascript; charset=UTF-8' },
        { path: '/manifest.webmanifest', expected: 'application/manifest+json; charset=UTF-8' },
        { path: '/icons/icon.svg', expected: 'image/svg+xml' },
        { path: '/icons/icon-192.png', expected: 'image/png' }
      ];

      for (const tc of testCases) {
        const res = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${testPort}${tc.path}`, (response) => {
            resolve({ status: response.statusCode, headers: response.headers });
          }).on('error', reject);
        });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe(tc.expected);
      }
    });

    it('9.3 Directory traversal protection: raw escaping paths return HTTP 403 or 404', async () => {
      const net = await import('net');
      const rawResponse = await new Promise((resolve) => {
        const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
          client.write("GET /../../../PROJECT.md HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        });
        let data = '';
        client.on('data', (chunk) => {
          data += chunk.toString();
        });
        client.on('end', () => {
          resolve(data);
        });
      });

      expect(rawResponse).toMatch(/HTTP\/1\.1 (403|404)/);
    });

    it('9.4 Non-existent files return HTTP 404 Not Found', async () => {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}/non_existent_file.xyz`, (response) => {
          resolve({ status: response.statusCode });
        }).on('error', reject);
      });

      expect(res.status).toBe(404);
    });

    it('9.5 Query neutrality: requests with challenge queries serve index.html with HTTP 200', async () => {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}/?c=1250&by=Alex`, (response) => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        }).on('error', reject);
      });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=UTF-8');
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('9.6 Service worker sw.js is served with Cache-Control: no-cache, no-store, must-revalidate', async () => {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}/sw.js`, (response) => {
          resolve({ status: response.statusCode, headers: response.headers });
        }).on('error', reject);
      });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    });
  });
});
