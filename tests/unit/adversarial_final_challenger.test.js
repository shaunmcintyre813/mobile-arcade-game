import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Player, RAIL_LEFT, RAIL_RIGHT, RAIL_X_LEFT, RAIL_X_RIGHT } from '../../src/player.js';
import { Obstacle, ObstacleManager, checkAABB, HAZARD_BARRIER, HAZARD_LASER_GATE, HAZARD_PULSE_NODE, GRAZE_MARGIN_DEFAULT } from '../../src/obstacles.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { TouchController } from '../../src/touch.js';
import { DisplayManager } from '../../src/display.js';
import { setupFullE2EEnvironment, createMockCanvas } from '../fixtures/e2e_harness.js';

function createInteractiveCanvas(width = 412, height = 915) {
  const listeners = {};
  const contextMock = {
    setTransform: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    strokeRect: vi.fn()
  };

  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: { width: `${width}px`, height: `${height}px` },
    getContext: vi.fn().mockReturnValue(contextMock),
    getBoundingClientRect: vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height
    }),
    addEventListener: vi.fn((type, fn) => {
      listeners[type] = fn;
    }),
    removeEventListener: vi.fn((type, fn) => {
      if (listeners[type] === fn) {
        delete listeners[type];
      }
    }),
    dispatchCanvasEvent: (type, eventData) => {
      if (listeners[type]) {
        listeners[type]({
          cancelable: true,
          preventDefault: vi.fn(),
          ...eventData
        });
      }
    }
  };

  return canvas;
}

describe('Challenger Final 1: Empirical Adversarial Stress Suite', () => {
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
  // 1. Rapid Touch Bursts (50+ taps and swipes/sec, zero missed flips, no bouncing)
  // =========================================================================
  describe('Dimension 1: Rapid Touch Bursts Stress Test', () => {
    it('1.1 Executes 60 rapid discrete taps in 1.0 second with exactly 60 alternating gravity flips and zero missed flips', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      expect(game.player.targetRail).toBe(RAIL_LEFT);

      let currentExpectedRail = RAIL_LEFT;
      let totalFlips = 0;

      for (let i = 0; i < 60; i++) {
        // Dispatch touchstart -> trigger flip
        canvas.dispatchCanvasEvent('touchstart', {
          changedTouches: [{ identifier: i + 1, clientX: 200, clientY: 450 }]
        });

        currentExpectedRail = currentExpectedRail === RAIL_LEFT ? RAIL_RIGHT : RAIL_LEFT;
        totalFlips++;

        expect(game.player.targetRail).toBe(currentExpectedRail);
        expect(game.player.isFlipping).toBe(true);

        // Dispatch touchend
        canvas.dispatchCanvasEvent('touchend', {
          changedTouches: [{ identifier: i + 1, clientX: 200, clientY: 450 }]
        });

        // Run 2 physics ticks (at 120Hz = 16.6ms) between taps
        game.update(1 / 120);
        game.update(1 / 120);

        // Verify player does not bounce back or miss flip
        expect(game.player.targetRail).toBe(currentExpectedRail);
      }

      expect(totalFlips).toBe(60);
      expect(game.player.targetRail).toBe(RAIL_LEFT); // 60 flips return to start (left)
    });

    it('1.2 High-frequency tap burst (10 taps within a single frame interval) handles flips deterministically without duplicate bouncing', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      // Dispatch 10 taps in immediate succession before game.update is called
      for (let i = 0; i < 10; i++) {
        canvas.dispatchCanvasEvent('touchstart', {
          changedTouches: [{ identifier: i + 100, clientX: 200, clientY: 450 }]
        });
        canvas.dispatchCanvasEvent('touchend', {
          changedTouches: [{ identifier: i + 100, clientX: 200, clientY: 450 }]
        });
      }

      // 10 flips from RAIL_LEFT: left -> right -> left -> right -> ... (10 times ends at RAIL_LEFT)
      expect(game.player.targetRail).toBe(RAIL_LEFT);

      // Now execute the frame update
      game.update(1 / 120);

      // Must remain at RAIL_LEFT (no ghost flips from drained buffer)
      expect(game.player.targetRail).toBe(RAIL_LEFT);
    });

    it('1.3 Rapid touch bursts with interleaved micro-swipes (50 cycles/sec) maintains touch state integrity and zero deadlocks', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      for (let i = 0; i < 50; i++) {
        const id = i + 500;
        // Start touch
        canvas.dispatchCanvasEvent('touchstart', {
          changedTouches: [{ identifier: id, clientX: 200, clientY: 450 }]
        });
        expect(game.touch.touchActive).toBe(true);

        // Move touch slightly (swipe)
        canvas.dispatchCanvasEvent('touchmove', {
          changedTouches: [{ identifier: id, clientX: 215, clientY: 450 }]
        });

        // Release touch
        canvas.dispatchCanvasEvent('touchend', {
          changedTouches: [{ identifier: id, clientX: 215, clientY: 450 }]
        });
        expect(game.touch.touchActive).toBe(false);

        game.update(1 / 120);
      }

      expect(game.touch.touchActive).toBe(false);
      expect(Number.isFinite(game.player.x)).toBe(true);
      expect(game.player.x).toBeGreaterThanOrEqual(RAIL_X_LEFT - 35);
      expect(game.player.x).toBeLessThanOrEqual(RAIL_X_RIGHT + 35);
    });

    it('1.4 Touchcancel event mid-burst cleanly clears active state and prevents stuck drag offset', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      canvas.dispatchCanvasEvent('touchstart', {
        changedTouches: [{ identifier: 999, clientX: 200, clientY: 450 }]
      });
      expect(game.touch.touchActive).toBe(true);

      canvas.dispatchCanvasEvent('touchmove', {
        changedTouches: [{ identifier: 999, clientX: 280, clientY: 450 }]
      });

      // Abrupt touchcancel (e.g. system gesture, incoming call notification)
      canvas.dispatchCanvasEvent('touchcancel', {});
      expect(game.touch.touchActive).toBe(false);
      expect(game.touch.touchId).toBeNull();
      expect(game.touch.dragDeltaX).toBe(0);

      // Subsequent touch immediately works
      canvas.dispatchCanvasEvent('touchstart', {
        changedTouches: [{ identifier: 1000, clientX: 200, clientY: 450 }]
      });
      expect(game.touch.touchActive).toBe(true);
      expect(game.touch.touchId).toBe(1000);
    });

    it('1.5 Multi-touch burst rejection: secondary and tertiary fingers do not cause spurious flips or jitter', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      // Primary finger touches
      canvas.dispatchCanvasEvent('touchstart', {
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 450 }]
      });
      expect(game.player.targetRail).toBe(RAIL_RIGHT);

      // Secondary and tertiary fingers spam touchstart
      for (let finger = 2; finger <= 10; finger++) {
        canvas.dispatchCanvasEvent('touchstart', {
          changedTouches: [{ identifier: finger, clientX: 300, clientY: 500 }]
        });
        // Must NOT toggle flip
        expect(game.player.targetRail).toBe(RAIL_RIGHT);
      }

      // Secondary fingers move
      for (let finger = 2; finger <= 10; finger++) {
        canvas.dispatchCanvasEvent('touchmove', {
          changedTouches: [{ identifier: finger, clientX: 100, clientY: 200 }]
        });
      }

      // Primary finger releases
      canvas.dispatchCanvasEvent('touchend', {
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 450 }]
      });
      expect(game.touch.touchActive).toBe(false);
    });
  });

  // =========================================================================
  // 2. Micro-Drag Lateral Evasion Fuzzing (Extreme out-of-bounds [-5000, 5000])
  // =========================================================================
  describe('Dimension 2: Micro-Drag Lateral Evasion Fuzzing', () => {
    it('2.1 Fuzzes player.applyMicroDrag with 10,000 extreme values in [-5000, 5000] and verifies strict bounding in [45, 355]', () => {
      const player = new Player({ leftRailX: 80, rightRailX: 320, maxDragOffset: 35 });
      const MIN_X = RAIL_X_LEFT - 35; // 45
      const MAX_X = RAIL_X_RIGHT + 35; // 355

      // Include pathological values
      const pathologicalValues = [
        -5000, 5000, -4999.999, 4999.999, -1000, 1000, -35, 35, -35.0001, 35.0001,
        0, -0, -1e12, 1e12, -Infinity, Infinity, NaN, null, undefined, 'bad_input'
      ];

      for (const val of pathologicalValues) {
        player.applyMicroDrag(val);
        expect(player.dragOffset).toBeGreaterThanOrEqual(-35);
        expect(player.dragOffset).toBeLessThanOrEqual(35);
        expect(Number.isFinite(player.dragOffset)).toBe(true);
      }

      // Run 10,000 pseudo-random extreme values
      for (let i = 0; i < 10000; i++) {
        // Random value uniformly in [-5000, 5000]
        const extremeDelta = (Math.random() - 0.5) * 10000;
        player.applyMicroDrag(extremeDelta);

        expect(player.dragOffset).toBeGreaterThanOrEqual(-35);
        expect(player.dragOffset).toBeLessThanOrEqual(35);

        player.update(1 / 120);

        expect(player.x).toBeGreaterThanOrEqual(MIN_X - 1e-4);
        expect(player.x).toBeLessThanOrEqual(MAX_X + 1e-4);
        expect(Number.isFinite(player.x)).toBe(true);
        expect(Number.isFinite(player.vx)).toBe(true);
        expect(Number.isFinite(player.tilt)).toBe(true);
      }
    });

    it('2.2 Direct setMicroDrag fuzzing with [-10000, 10000] enforces strict [-35, 35] clamping', () => {
      const player = new Player({ leftRailX: 80, rightRailX: 320, maxDragOffset: 35 });

      const testValues = [-10000, -5000, -100, -35.1, -35, -10, 0, 10, 35, 35.1, 100, 5000, 10000];
      for (const val of testValues) {
        player.setMicroDrag(val);
        expect(player.dragOffset).toBeGreaterThanOrEqual(-35);
        expect(player.dragOffset).toBeLessThanOrEqual(35);
      }
    });

    it('2.3 End-to-end touchmove fuzzing with extreme clientX [-5000, 5000] maintains player boundedness', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      canvas.dispatchCanvasEvent('touchstart', {
        changedTouches: [{ identifier: 1, clientX: 200, clientY: 450 }]
      });

      const extremeClientX = [-5000, -2000, -500, 0, 200, 412, 1000, 3000, 5000];
      for (const cx of extremeClientX) {
        canvas.dispatchCanvasEvent('touchmove', {
          changedTouches: [{ identifier: 1, clientX: cx, clientY: 450 }]
        });
        game.update(1 / 120);

        expect(game.player.dragOffset).toBeGreaterThanOrEqual(-35);
        expect(game.player.dragOffset).toBeLessThanOrEqual(35);
        expect(game.player.x).toBeGreaterThanOrEqual(RAIL_X_LEFT - 35);
        expect(game.player.x).toBeLessThanOrEqual(RAIL_X_RIGHT + 35);
      }
    });

    it('2.4 Gravity flip during active extreme micro-drag immediately resets dragOffset to zero', () => {
      const player = new Player({ leftRailX: 80, rightRailX: 320, maxDragOffset: 35 });
      player.applyMicroDrag(35); // Max right evasion
      expect(player.dragOffset).toBe(35);

      // Flip gravity
      player.flipGravity();

      // Must be immediately zeroed to prevent wild slingshot trajectories
      expect(player.dragOffset).toBe(0);
      expect(player.isFlipping).toBe(true);
      expect(player.targetRail).toBe(RAIL_RIGHT);
    });
  });

  // =========================================================================
  // 3. Sub-Pixel Boundary Conditions: Lethal Collision vs Near-Miss Graze Margin
  // =========================================================================
  describe('Dimension 3: Lethal Collision vs Near-Miss Graze Margin Sub-Pixel Accuracy', () => {
    let obsManager;
    let player;

    beforeEach(() => {
      obsManager = new ObstacleManager();
      player = new Player({ width: 22, height: 26, y: 500 });
      // Player hitbox at x=200, y=500:
      // halfW = 11, halfH = 13
      // left: 189, right: 211, top: 487, bottom: 513
      player.x = 200;
      player.y = 500;
    });

    it('3.1 Verifies exact sub-pixel boundary on Left/Right axis for lethal collision vs graze vs safe', () => {
      // Barrier obstacle centered at x=300, y=500, width=68, height=24, grazeMargin=20
      // Obstacle lethal bounds:
      // halfW = 34, halfH = 12
      // left: 266, right: 334, top: 488, bottom: 512
      // Obstacle graze bounds (+20px):
      // left: 246, right: 354, top: 468, bottom: 532
      const barrier = new Obstacle({
        type: HAZARD_BARRIER,
        x: 300,
        y: 500,
        width: 68,
        height: 24,
        grazeMargin: 20
      });
      obsManager.obstacles = [barrier];

      // A) OUTSIDE GRAZE (SAFE):
      // player.right must be <= 246. Player halfW = 11, so player.x <= 235.
      player.x = 234.999; // player.right = 245.999 < 246
      let res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false);
      expect(res.nearMisses.length).toBe(0);

      // B) EXACT GRAZE BOUNDARY:
      player.x = 235.0; // player.right = 246.000 == barrier graze left
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false);
      expect(res.nearMisses.length).toBe(0); // strict inequality a.right > b.left

      // C) SUB-PIXEL INSIDE GRAZE (+0.001px penetration into graze corridor):
      player.x = 235.001; // player.right = 246.001 > 246
      barrier.grazed = false; // reset for test
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false);
      expect(res.nearMisses.length).toBe(1);
      expect(barrier.grazed).toBe(true);

      // D) DEEP IN GRAZE CORRIDOR, OUTSIDE LETHAL:
      player.x = 254.999; // player.right = 265.999 < 266 (barrier lethal left)
      barrier.grazed = false;
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false);
      expect(res.nearMisses.length).toBe(1);

      // E) EXACT LETHAL BOUNDARY (Touching edge):
      player.x = 255.0; // player.right = 266.000 == barrier lethal left
      barrier.grazed = false;
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false); // Touching edge is NOT lethal (strict inequality a.right > b.left)
      expect(res.nearMisses.length).toBe(1); // But it IS a near-miss graze!

      // F) SUB-PIXEL INSIDE LETHAL (+0.001px penetration into lethal box):
      player.x = 255.001; // player.right = 266.001 > 266
      barrier.grazed = false;
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(true);
      expect(res.lethalObstacle).toBe(barrier);
      expect(res.nearMisses.length).toBe(0); // Lethal takes complete precedence over graze
    });

    it('3.2 Verifies exact sub-pixel boundary on Top/Bottom vertical axis', () => {
      // Barrier at x=200, y=400, width=68, height=24, grazeMargin=20
      // Obstacle lethal bounds:
      // left: 166, right: 234, top: 388, bottom: 412
      // Obstacle graze bounds:
      // top: 368, bottom: 432
      // Player: width=22, height=26, halfH=13, x=200
      const barrier = new Obstacle({
        type: HAZARD_BARRIER,
        x: 200,
        y: 400,
        width: 68,
        height: 24,
        grazeMargin: 20
      });
      obsManager.obstacles = [barrier];

      // A) Player above graze: player.bottom <= 368 -> player.y <= 355
      player.y = 354.999; // bottom = 367.999 < 368
      let res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false);
      expect(res.nearMisses.length).toBe(0);

      // B) Player enters graze vertically from top: player.y = 355.001 -> bottom = 368.001 > 368
      player.y = 355.001;
      barrier.grazed = false;
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false);
      expect(res.nearMisses.length).toBe(1);

      // C) Player exact lethal top boundary: player.bottom = 388 -> player.y = 375
      player.y = 375.0;
      barrier.grazed = false;
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(false);
      expect(res.nearMisses.length).toBe(1);

      // D) Player sub-pixel inside lethal top: player.bottom = 388.001 -> player.y = 375.001
      player.y = 375.001;
      barrier.grazed = false;
      res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(true);
    });

    it('3.3 Near-miss idempotency: continuous flight in graze corridor triggers graze bonus EXACTLY once', () => {
      const barrier = new Obstacle({
        type: HAZARD_BARRIER,
        x: 280,
        y: 500,
        width: 68,
        height: 24,
        grazeMargin: 20
      });
      obsManager.obstacles = [barrier];

      // Position player in graze corridor
      // Barrier lethal left: 246. Barrier graze left: 226.
      // Player: x=225, halfW=11 -> left=214, right=236 (inside [226, 246])
      player.x = 225;
      player.y = 500;

      let totalGrazes = 0;
      // Step player alongside obstacle for 50 consecutive frames
      for (let frame = 0; frame < 50; frame++) {
        const res = obsManager.checkCollisions(player);
        expect(res.lethal).toBe(false);
        totalGrazes += res.nearMisses.length;
      }

      // Must be EXACTLY 1, preventing infinite multiplier combo exploit
      expect(totalGrazes).toBe(1);
    });

    it('3.4 Lethal priority: when both lethal and graze overlap, only lethal is dispatched', () => {
      const pulseNode = new Obstacle({
        type: HAZARD_PULSE_NODE,
        x: 200,
        y: 500,
        width: 28,
        height: 28,
        grazeMargin: 20
      });
      obsManager.obstacles = [pulseNode];

      // Direct center hit
      player.x = 200;
      player.y = 500;

      const res = obsManager.checkCollisions(player);
      expect(res.lethal).toBe(true);
      expect(res.lethalObstacle).toBe(pulseNode);
      expect(res.nearMisses.length).toBe(0);
      expect(pulseNode.grazed).toBe(false); // Did not register graze
    });
  });

  // =========================================================================
  // 4. 120Hz Fixed Timestep Accumulator & Frame Time Hitching (Spiral of Death)
  // =========================================================================
  describe('Dimension 4: 120Hz Accumulator & Hitching Clamping Stress Test', () => {
    it('4.1 Extreme 2.0-second tab freeze hitch clamps delta to 0.1s and executes exactly 12 sub-steps (prevents spiral of death)', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      // Spy on synchronous update(dt)
      const updateSpy = vi.spyOn(game, 'update');

      // Initialize lastTime
      game.running = true;
      game.lastTime = 1000.0;
      game.accumulatedTime = 0;

      // Simulate browser tab resuming after 2.0 second freeze: currentTime = 3000.0
      game.tick(3000.0);

      // Clamped delta = 0.1s (100ms)
      // Sub-step dt = 1/120s = 0.008333s
      // Number of steps: floor(0.1 / (1/120)) = 12 steps
      // Without clamp, it would execute 240 steps!
      expect(updateSpy).toHaveBeenCalledTimes(12);

      // Remaining accumulated time is less than 1 fixed time step
      expect(game.accumulatedTime).toBeLessThan(game.fixedTimeStep);
      expect(game.accumulatedTime).toBeGreaterThanOrEqual(0);
    });

    it('4.2 Severe sustained hitching (50 consecutive frames at 500ms) keeps accumulator strictly bounded', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      const updateSpy = vi.spyOn(game, 'update');
      game.running = true;
      game.lastTime = 0;
      game.accumulatedTime = 0;

      let simTime = 0;
      for (let frame = 0; frame < 50; frame++) {
        simTime += 500; // 500ms per frame
        game.tick(simTime);

        // Accumulator should NEVER explode
        expect(game.accumulatedTime).toBeLessThan(game.fixedTimeStep);
        expect(game.accumulatedTime).toBeGreaterThanOrEqual(0);
      }

      // 50 frames * 12 steps/frame = 600 steps (not 50 * 60 = 3000)
      expect(updateSpy).toHaveBeenCalledTimes(600);
    });

    it('4.3 Verifies exact sub-stepping ratios across 60Hz, 120Hz, and 240Hz refresh rates', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      // Test A: 60Hz display (1000/60 ms per tick)
      game.running = true;
      game.accumulatedTime = 0;
      game.lastTime = 0;
      const updateSpy = vi.spyOn(game, 'update');

      game.tick(1000 / 60);
      expect(updateSpy).toHaveBeenCalledTimes(2); // exactly 2 steps

      updateSpy.mockClear();

      // Test B: 120Hz display (1000/120 ms per tick)
      game.accumulatedTime = 0;
      game.lastTime = 0;
      game.tick(1000 / 120);
      expect(updateSpy).toHaveBeenCalledTimes(1); // exactly 1 step

      updateSpy.mockClear();

      // Test C: 240Hz display (1000/240 ms per tick)
      game.accumulatedTime = 0;
      game.lastTime = 0;
      game.tick(1000 / 240);
      expect(updateSpy).toHaveBeenCalledTimes(0); // accumulates first frame
      game.tick((1000 / 240) * 2);
      expect(updateSpy).toHaveBeenCalledTimes(1); // steps on second frame
    });

    it('4.4 Clock backwards jump / negative delta hitching recovers safely without crash or infinite loops', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const game = new GameEngine(canvas);
      game.startPlaying();

      game.running = true;
      game.lastTime = 5000.0;
      game.accumulatedTime = 0.005;

      // System clock rolls backwards (e.g. NTP sync)
      expect(() => game.tick(4500.0)).not.toThrow();

      // Next normal tick resumes cleanly
      expect(() => game.tick(4516.6)).not.toThrow();
    });
  });

  // =========================================================================
  // 5. Dynamic Resize & Aspect Ratio Shifts During Active Flight
  // =========================================================================
  describe('Dimension 5: Dynamic Resize & Aspect Ratio Shifts Stress Test', () => {
    it('5.1 Dynamic aspect ratio shifts mid-flight preserve virtual coordinate projection and math invertibility', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const display = new DisplayManager(canvas);

      const testResolutions = [
        { w: 412, h: 915, name: 'Samsung Galaxy S25 Ultra (20:9)' },
        { w: 360, h: 640, name: 'Standard Compact (16:9)' },
        { w: 768, h: 1024, name: 'Tablet (4:3)' },
        { w: 600, h: 600, name: 'Square Foldable (1:1)' },
        { w: 100, h: 2000, name: 'Extreme Ultra-Tall (1:20)' },
        { w: 915, h: 412, name: 'Rotated Landscape' },
        { w: 412, h: 915, name: 'Restored S25 Ultra' }
      ];

      for (const res of testResolutions) {
        canvas.clientWidth = res.w;
        canvas.clientHeight = res.h;
        env.window.innerWidth = res.w;
        env.window.innerHeight = res.h;

        const bounds = display.resize();

        expect(bounds.width).toBe(400); // Fixed virtual width
        expect(Number.isFinite(bounds.height)).toBe(true);
        expect(bounds.height).toBeGreaterThan(0);
        expect(Number.isFinite(bounds.scale)).toBe(true);
        expect(bounds.scale).toBeGreaterThan(0);
        expect(bounds.dpr).toBeGreaterThanOrEqual(1.0);
        expect(bounds.dpr).toBeLessThanOrEqual(3.0);

        // Bijective invertibility check on 500 coordinates
        for (let i = 0; i < 500; i++) {
          const screenX = Math.random() * res.w;
          const screenY = Math.random() * res.h;

          const virt = display.screenToVirtual(screenX, screenY);
          expect(Number.isFinite(virt.x)).toBe(true);
          expect(Number.isFinite(virt.y)).toBe(true);

          // Reverse projection: screen = virt * scale
          const backX = virt.x * bounds.scale;
          const backY = virt.y * bounds.scale;

          expect(backX).toBeCloseTo(screenX, 4);
          expect(backY).toBeCloseTo(screenY, 4);
        }
      }
    });

    it('5.2 In-flight obstacle culling adapts immediately to dynamic virtual height shrinkage', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const display = new DisplayManager(canvas);
      const game = new GameEngine(canvas, { displayManager: display });
      game.startPlaying();

      // Spawn 5 obstacles down the screen
      game.obstacles.obstacles = [
        new Obstacle({ type: HAZARD_BARRIER, x: 80, y: 100 }),
        new Obstacle({ type: HAZARD_BARRIER, x: 320, y: 300 }),
        new Obstacle({ type: HAZARD_BARRIER, x: 80, y: 550 }),
        new Obstacle({ type: HAZARD_BARRIER, x: 320, y: 750 }),
        new Obstacle({ type: HAZARD_BARRIER, x: 80, y: 850 })
      ];

      expect(game.obstacles.obstacles.length).toBe(5);

      // Shrunk viewport: 412x400 -> scale = 1.03 -> virtualHeight ≈ 388.35
      // Obstacle culling boundary: virtualHeight + 80 ≈ 468.35
      canvas.clientHeight = 400;
      env.window.innerHeight = 400;
      display.resize();

      // Step physics tick
      game.update(1 / 120);

      // Obstacles at y=550, 750, 850 are > 468.35 and must be culled!
      // Only obstacles at y=100 and y=300 survive
      expect(game.obstacles.obstacles.length).toBe(2);
      expect(game.obstacles.obstacles[0].y).toBeGreaterThan(100);
      expect(game.obstacles.obstacles[1].y).toBeGreaterThan(300);
    });

    it('5.3 Active flight survival: player updates, flips, and drags during continuous resize storm without NaN or out-of-bounds positions', () => {
      const canvas = createInteractiveCanvas(412, 915);
      const display = new DisplayManager(canvas);
      const game = new GameEngine(canvas, { displayManager: display });
      game.startPlaying();

      const MIN_X = RAIL_X_LEFT - 35;
      const MAX_X = RAIL_X_RIGHT + 35;

      for (let tick = 0; tick < 120; tick++) {
        // Every 10 ticks, resize to random aspect ratio
        if (tick % 10 === 0) {
          const w = 320 + Math.floor(Math.random() * 500);
          const h = 500 + Math.floor(Math.random() * 600);
          canvas.clientWidth = w;
          canvas.clientHeight = h;
          env.window.innerWidth = w;
          env.window.innerHeight = h;
          display.resize();
        }

        // Random flips and micro-drags
        if (tick % 25 === 0) {
          game.handleTap();
        }
        if (tick % 5 === 0) {
          const deltaX = (Math.random() - 0.5) * 50;
          game.player.applyMicroDrag(deltaX);
        }

        game.update(1 / 120);

        // Assert player invariants during resize storm
        expect(Number.isFinite(game.player.x)).toBe(true);
        expect(Number.isFinite(game.player.y)).toBe(true);
        expect(Number.isFinite(game.player.vx)).toBe(true);
        expect(Number.isFinite(game.player.tilt)).toBe(true);
        expect(game.player.x).toBeGreaterThanOrEqual(MIN_X - 1e-4);
        expect(game.player.x).toBeLessThanOrEqual(MAX_X + 1e-4);
      }
    });
  });
});
