import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Player, RAIL_LEFT, RAIL_RIGHT, RAIL_X_LEFT, RAIL_X_RIGHT } from '../../src/player.js';
import { Obstacle, ObstacleManager, checkAABB, HAZARD_BARRIER, HAZARD_LASER_GATE, HAZARD_PULSE_NODE, GRAZE_MARGIN_DEFAULT } from '../../src/obstacles.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { ParticleSystem } from '../../src/particles.js';

function createMockCanvas() {
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

  return {
    width: 400,
    height: 888,
    clientWidth: 400,
    clientHeight: 888,
    style: { width: '400px', height: '888px' },
    getContext: vi.fn().mockReturnValue(contextMock),
    getBoundingClientRect: vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 888,
      width: 400,
      height: 888
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
}

describe('Adversarial Stress Suite M2: Player Rail Flipping & Micro-Drag Boundedness', () => {
  let player;
  const MIN_ALLOWED_X = RAIL_X_LEFT - 35; // 80 - 35 = 45
  const MAX_ALLOWED_X = RAIL_X_RIGHT + 35; // 320 + 35 = 355

  beforeEach(() => {
    player = new Player({ leftRailX: 80, rightRailX: 320, y: 650, maxDragOffset: 35 });
  });

  it('Stress Test 1.1: 100 rapid alternating flips in 1 second maintains strictly bounded and stable position x', () => {
    const totalTicks = 120; // 1 second at 120Hz
    const dt = 1 / 120;

    // Trigger 100 flips distributed across 120 ticks
    const flipTicks = new Set();
    while (flipTicks.size < 100) {
      flipTicks.add(Math.floor(Math.random() * totalTicks));
    }

    let flipsExecuted = 0;
    for (let tick = 0; tick < totalTicks; tick++) {
      if (flipTicks.has(tick)) {
        player.flipGravity();
        flipsExecuted++;
      }

      player.update(dt);

      // Invariant checks at every single sub-step
      expect(Number.isFinite(player.x)).toBe(true);
      expect(Number.isFinite(player.vx)).toBe(true);
      expect(Number.isFinite(player.tilt)).toBe(true);
      expect(player.x).toBeGreaterThanOrEqual(MIN_ALLOWED_X - 1e-4);
      expect(player.x).toBeLessThanOrEqual(MAX_ALLOWED_X + 1e-4);
      expect(Math.abs(player.tilt)).toBeLessThanOrEqual(0.36); // max tilt ~0.35 rad
    }

    expect(flipsExecuted).toBe(100);
  });

  it('Stress Test 1.2: Out-of-bounds micro-drag stress [-1000, +1000] strictly clamps dragOffset and targetX', () => {
    const testDeltas = [
      -1000, -999.9, -500, -100, -50, -36, -35.001, -35,
      0,
      35, 35.001, 36, 50, 100, 500, 999.9, 1000,
      -1e6, 1e6, -Infinity, Infinity, NaN, 'invalid', null, undefined
    ];

    for (const delta of testDeltas) {
      player.applyMicroDrag(delta);
      expect(player.dragOffset).toBeGreaterThanOrEqual(-35);
      expect(player.dragOffset).toBeLessThanOrEqual(35);

      player.setMicroDrag(delta);
      expect(player.dragOffset).toBeGreaterThanOrEqual(-35);
      expect(player.dragOffset).toBeLessThanOrEqual(35);
    }
  });

  it('Stress Test 1.3: 10,000 random adversarial drag values maintain strict bounds', () => {
    for (let i = 0; i < 10000; i++) {
      const randomDelta = (Math.random() - 0.5) * 2000; // [-1000, +1000]
      player.applyMicroDrag(randomDelta);

      expect(player.dragOffset).toBeGreaterThanOrEqual(-35);
      expect(player.dragOffset).toBeLessThanOrEqual(35);

      player.update(1 / 120);
      expect(player.x).toBeGreaterThanOrEqual(MIN_ALLOWED_X - 1e-4);
      expect(player.x).toBeLessThanOrEqual(MAX_ALLOWED_X + 1e-4);
    }
  });

  it('Stress Test 1.4: Concurrent rapid flip spamming combined with maximum micro-drag abuse', () => {
    const dt = 1 / 120;
    // 500 ticks of simultaneous flip spam + extreme drag injections
    for (let tick = 0; tick < 500; tick++) {
      if (tick % 2 === 0) {
        player.flipGravity();
      }
      player.applyMicroDrag(tick % 3 === 0 ? 1000 : -1000);
      player.update(dt);

      expect(player.x).toBeGreaterThanOrEqual(MIN_ALLOWED_X - 1e-4);
      expect(player.x).toBeLessThanOrEqual(MAX_ALLOWED_X + 1e-4);
      expect(Number.isFinite(player.x)).toBe(true);
    }
  });

  it('Stress Test 1.5: Trail buffer integrity under rapid flipping', () => {
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) player.flipGravity();
      player.update(0.016);
    }

    expect(player.trail.length).toBe(12);
    for (const point of player.trail) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(MIN_ALLOWED_X - 1e-4);
      expect(point.x).toBeLessThanOrEqual(MAX_ALLOWED_X + 1e-4);
    }
  });
});

describe('Adversarial Stress Suite M2: Sub-Pixel Collision Detection (Lethal vs Near-Miss Graze)', () => {
  let manager;
  let obstacle;

  // Barrier at center (80, 500), width=64, height=22, grazeMargin=20
  // Lethal box: left = 48, right = 112, top = 489, bottom = 511
  // Graze box:  left = 28, right = 132, top = 469, bottom = 531
  // Player hitbox: width = 22, height = 26 (halfW = 11, halfH = 13)
  beforeEach(() => {
    manager = new ObstacleManager();
    obstacle = new Obstacle({
      type: HAZARD_BARRIER,
      x: 80,
      y: 500,
      width: 64,
      height: 22,
      grazeMargin: 20
    });
    manager.obstacles = [obstacle];
  });

  it('Stress Test 2.1: Right-edge sub-pixel boundary between lethal crash and near-miss graze', () => {
    // Player approaching from the right at y=500
    // Player left edge is (x - 11). Lethal right is 112.
    // Exact lethal boundary: x = 112 + 11 = 123.000000

    // Sub-test A: Sub-pixel INSIDE lethal box (penetration by 0.001 px)
    // x = 122.999 -> player.left = 111.999 < 112.000 -> LETHAL
    const playerLethal = {
      getHitbox: () => ({ left: 111.999, right: 133.999, top: 487, bottom: 513 })
    };
    obstacle.grazed = false;
    const resLethal = manager.checkCollisions(playerLethal);
    expect(resLethal.lethal).toBe(true);
    expect(resLethal.lethalObstacle).toBe(obstacle);

    // Sub-test B: Sub-pixel OUTSIDE lethal box (separation by 0.001 px)
    // x = 123.001 -> player.left = 112.001 > 112.000 (not lethal), but < 132 (inside graze)
    const playerGraze = {
      getHitbox: () => ({ left: 112.001, right: 134.001, top: 487, bottom: 513 })
    };
    obstacle.grazed = false;
    const resGraze = manager.checkCollisions(playerGraze);
    expect(resGraze.lethal).toBe(false);
    expect(resGraze.nearMisses.length).toBe(1);
    expect(resGraze.nearMisses[0]).toBe(obstacle);
    expect(obstacle.grazed).toBe(true);

    // Sub-test C: Exact mathematical boundary (left === right === 112.000)
    // Non-penetrating touch: checkAABB uses strictly <, so left < right is 112 < 112 = false (not lethal)
    const playerTouch = {
      getHitbox: () => ({ left: 112.000, right: 134.000, top: 487, bottom: 513 })
    };
    obstacle.grazed = false;
    const resTouch = manager.checkCollisions(playerTouch);
    expect(resTouch.lethal).toBe(false);
    expect(resTouch.nearMisses.length).toBe(1); // Touches inside graze
  });

  it('Stress Test 2.2: Outer graze boundary sub-pixel transition between near-miss and total miss', () => {
    // Graze right edge is 132.
    // Player left edge is (x - 11).
    // Exact graze boundary is at x = 132 + 11 = 143.000000

    // Sub-test A: Sub-pixel INSIDE graze box (by 0.001 px)
    // player.left = 131.999 < 132.000 -> GRAZE
    const playerGraze = {
      getHitbox: () => ({ left: 131.999, right: 153.999, top: 487, bottom: 513 })
    };
    obstacle.grazed = false;
    const resGraze = manager.checkCollisions(playerGraze);
    expect(resGraze.lethal).toBe(false);
    expect(resGraze.nearMisses.length).toBe(1);

    // Sub-test B: Sub-pixel OUTSIDE graze box (by 0.001 px)
    // player.left = 132.001 > 132.000 -> COMPLETE MISS
    const playerMiss = {
      getHitbox: () => ({ left: 132.001, right: 154.001, top: 487, bottom: 513 })
    };
    obstacle.grazed = false;
    const resMiss = manager.checkCollisions(playerMiss);
    expect(resMiss.lethal).toBe(false);
    expect(resMiss.nearMisses.length).toBe(0);
  });

  it('Stress Test 2.3: Left-edge sub-pixel boundary between lethal crash and near-miss graze', () => {
    // Lethal left edge is 48. Player right edge is (x + 11).
    // Sub-pixel inside lethal: player.right = 48.001 > 48.000 -> LETHAL
    const playerLethal = {
      getHitbox: () => ({ left: 26.001, right: 48.001, top: 487, bottom: 513 })
    };
    obstacle.grazed = false;
    const resLethal = manager.checkCollisions(playerLethal);
    expect(resLethal.lethal).toBe(true);

    // Sub-pixel outside lethal: player.right = 47.999 < 48.000 -> GRAZE (inside graze left 28)
    const playerGraze = {
      getHitbox: () => ({ left: 25.999, right: 47.999, top: 487, bottom: 513 })
    };
    obstacle.grazed = false;
    const resGraze = manager.checkCollisions(playerGraze);
    expect(resGraze.lethal).toBe(false);
    expect(resGraze.nearMisses.length).toBe(1);
  });

  it('Stress Test 2.4: Top and Bottom edge sub-pixel boundaries', () => {
    // Top: Lethal top is 489. Player bottom is (y + 13).
    // Player bottom = 489.001 -> LETHAL
    const playerTopLethal = {
      getHitbox: () => ({ left: 70, right: 90, top: 463.001, bottom: 489.001 })
    };
    obstacle.grazed = false;
    expect(manager.checkCollisions(playerTopLethal).lethal).toBe(true);

    // Player bottom = 488.999 -> GRAZE (inside graze top 469)
    const playerTopGraze = {
      getHitbox: () => ({ left: 70, right: 90, top: 462.999, bottom: 488.999 })
    };
    obstacle.grazed = false;
    const resTopGraze = manager.checkCollisions(playerTopGraze);
    expect(resTopGraze.lethal).toBe(false);
    expect(resTopGraze.nearMisses.length).toBe(1);

    // Bottom: Lethal bottom is 511. Player top is (y - 13).
    // Player top = 510.999 -> LETHAL
    const playerBottomLethal = {
      getHitbox: () => ({ left: 70, right: 90, top: 510.999, bottom: 536.999 })
    };
    obstacle.grazed = false;
    expect(manager.checkCollisions(playerBottomLethal).lethal).toBe(true);

    // Player top = 511.001 -> GRAZE (inside graze bottom 531)
    const playerBottomGraze = {
      getHitbox: () => ({ left: 70, right: 90, top: 511.001, bottom: 537.001 })
    };
    obstacle.grazed = false;
    const resBottomGraze = manager.checkCollisions(playerBottomGraze);
    expect(resBottomGraze.lethal).toBe(false);
    expect(resBottomGraze.nearMisses.length).toBe(1);
  });

  it('Stress Test 2.5: Near-miss strictly increments combo multiplier without dying in GameEngine', () => {
    const canvas = createMockCanvas();
    const game = new GameEngine(canvas);
    game.startPlaying();

    expect(game.comboMultiplier).toBe(1);
    expect(game.score).toBe(0);

    // Place obstacle in graze position relative to player (x=80, y=650)
    // Player width 22 -> [69, 91], height 26 -> [637, 663]
    // Obstacle lethal: x=123.001 + 32 = 155.001, y=650 -> lethal left is 123.001 > player right 91?
    // Let's place obstacle so its graze box encompasses player, but lethal box does NOT
    // Obstacle at x=123, width=40 -> lethal: [103, 143], graze: [83, 163]
    // Player is at x=80 -> player hitbox [69, 91] overlaps graze [83, 163] (83 < 91),
    // but player right 91 < lethal left 103!
    const grazeObstacle = new Obstacle({
      type: HAZARD_BARRIER,
      x: 123,
      y: 650,
      width: 40,
      height: 22,
      grazeMargin: 20
    });
    game.obstacles.obstacles = [grazeObstacle];

    // Single physics tick
    game.update(1 / 120);

    expect(game.state).toBe(STATE_PLAYING);
    expect(game.comboMultiplier).toBe(2); // Incremented from 1 to 2
    expect(game.score).toBeGreaterThan(0);
    expect(grazeObstacle.grazed).toBe(true);

    // Over 50 subsequent ticks with same obstacle, combo multiplier must NOT increment again
    for (let i = 0; i < 50; i++) {
      game.update(1 / 120);
    }
    expect(game.comboMultiplier).toBe(2);
    expect(game.state).toBe(STATE_PLAYING);
  });

  it('Stress Test 2.6: Grazed obstacle triggers lethal crash if player later penetrates lethal box', () => {
    // Player starts in graze zone
    const playerGraze = {
      getHitbox: () => ({ left: 115, right: 125, top: 495, bottom: 505 })
    };
    const resGraze = manager.checkCollisions(playerGraze);
    expect(resGraze.lethal).toBe(false);
    expect(resGraze.nearMisses.length).toBe(1);
    expect(obstacle.grazed).toBe(true);

    // Player now penetrates lethal zone [48, 112]
    const playerLethal = {
      getHitbox: () => ({ left: 90, right: 100, top: 495, bottom: 505 })
    };
    const resLethal = manager.checkCollisions(playerLethal);
    expect(resLethal.lethal).toBe(true);
    expect(resLethal.lethalObstacle).toBe(obstacle);
  });

  it('Stress Test 2.7: High-speed tunneling immunity at maximum velocity (740 px/s)', () => {
    // Player stationary at x=80, y=650 (hitbox top=637, bottom=663, height=26)
    const playerHitbox = { left: 69, right: 91, top: 637, bottom: 663 };
    const player = { getHitbox: () => playerHitbox };

    // Obstacle spawns above and scrolls downward at 740 px/s
    // Step size at 120Hz = 740 * (1/120) = 6.1667 px/step
    const fastObstacle = new Obstacle({
      type: HAZARD_BARRIER,
      x: 80,
      y: 550, // Starts above player
      width: 64,
      height: 22
    });
    manager.obstacles = [fastObstacle];

    let collisionDetected = false;
    const dt = 1 / 120;
    const maxSpeed = 740;

    // Simulate downward scroll until obstacle passes player
    for (let step = 0; step < 50; step++) {
      fastObstacle.update(dt, maxSpeed);
      const res = manager.checkCollisions(player);
      if (res.lethal) {
        collisionDetected = true;
        break;
      }
    }

    // Lethal collision MUST be detected — obstacle cannot tunnel past player without colliding
    expect(collisionDetected).toBe(true);
  });

  it('Stress Test 2.8: High-speed near-miss detection immunity at maximum velocity (740 px/s)', () => {
    // Player positioned in graze corridor beside the rail: x = 122 (hitbox: [114, 130])
    // Barrier lethal right is 112, graze right is 132
    // Player left = 114 > 112 (outside lethal), player left < 132 (inside graze)
    const playerHitbox = { left: 114, right: 130, top: 637, bottom: 663 };
    const player = { getHitbox: () => playerHitbox };

    const fastObstacle = new Obstacle({
      type: HAZARD_BARRIER,
      x: 80,
      y: 550,
      width: 64,
      height: 22,
      grazeMargin: 20
    });
    manager.obstacles = [fastObstacle];

    let nearMissDetected = false;
    let lethalDetected = false;
    const dt = 1 / 120;
    const maxSpeed = 740;

    for (let step = 0; step < 50; step++) {
      fastObstacle.update(dt, maxSpeed);
      const res = manager.checkCollisions(player);
      if (res.lethal) lethalDetected = true;
      if (res.nearMisses.length > 0) nearMissDetected = true;
    }

    // Must detect near-miss graze without triggering lethal collision
    expect(lethalDetected).toBe(false);
    expect(nearMissDetected).toBe(true);
  });
});

describe('Adversarial Stress Suite M2: Fixed-Timestep Accumulator Clamp & Large Delta Hitch', () => {
  it('Stress Test 3.1: Massive frame drop (dt = 2.0s tab pause) is clamped to 0.1s and avoids spiral of death', () => {
    const canvas = createMockCanvas();
    const game = new GameEngine(canvas);

    let subStepCount = 0;
    const originalUpdate = game.update.bind(game);
    game.update = (dt) => {
      subStepCount++;
      originalUpdate(dt);
    };

    game.running = true;
    game.lastTime = 1000;

    // Simulate 2000ms pause (e.g. user minimized browser or mobile tab switched)
    game.tick(3000);

    // Clamp is 0.1s (100ms). Fixed timestep is 1/120s (8.333ms).
    // Exactly floor(0.1 / (1/120)) = 12 sub-steps must execute.
    expect(subStepCount).toBe(12);
    expect(subStepCount).toBeLessThan(15);
    expect(game.accumulatedTime).toBeLessThan(game.fixedTimeStep);
  });

  it('Stress Test 3.2: Accumulator clamp matrix across extreme frame gaps [0.1s to 3600s]', () => {
    const extremeDeltas = [0.1001, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 60.0, 3600.0];

    for (const deltaSec of extremeDeltas) {
      const canvas = createMockCanvas();
      const game = new GameEngine(canvas);

      let subStepCount = 0;
      game.update = () => {
        subStepCount++;
      };

      game.running = true;
      game.lastTime = 1000;
      game.tick(1000 + deltaSec * 1000);

      // In every extreme hitch, sub-steps must be capped at 12
      expect(subStepCount).toBe(12);
      expect(game.accumulatedTime).toBeLessThan(game.fixedTimeStep);
    }
  });

  it('Stress Test 3.3: Rapid erratic frame deltas (jitter from 1ms to 200ms)', () => {
    const canvas = createMockCanvas();
    const game = new GameEngine(canvas);

    let totalSubSteps = 0;
    game.update = () => {
      totalSubSteps++;
    };

    game.running = true;
    let currentTime = 1000;
    game.lastTime = currentTime;

    // Simulate 100 erratic animation frames
    for (let frame = 0; frame < 100; frame++) {
      const jitterMs = Math.random() < 0.2 ? Math.random() * 200 : Math.random() * 16.6;
      currentTime += jitterMs;
      game.tick(currentTime);

      expect(game.accumulatedTime).toBeGreaterThanOrEqual(0);
      expect(game.accumulatedTime).toBeLessThan(game.fixedTimeStep);
    }

    expect(totalSubSteps).toBeGreaterThan(0);
  });

  it('Stress Test 3.4: Game state recovery and position stability after 2.0s pause recovery', () => {
    const canvas = createMockCanvas();
    const game = new GameEngine(canvas);
    game.startPlaying();

    const initialX = game.player.x;
    const initialY = game.player.y;

    game.lastTime = 1000;
    game.running = true;

    // 2.0s tab pause
    game.tick(3000);

    // Player position remains valid and bounded
    expect(Number.isFinite(game.player.x)).toBe(true);
    expect(Number.isFinite(game.player.y)).toBe(true);
    expect(game.player.x).toBeGreaterThanOrEqual(RAIL_X_LEFT - 35);
    expect(game.player.x).toBeLessThanOrEqual(RAIL_X_RIGHT + 35);

    // Resume normal 120Hz operation
    for (let step = 0; step < 60; step++) {
      game.tick(3000 + (step + 1) * (1000 / 120));
      expect(Number.isFinite(game.player.x)).toBe(true);
    }
  });
});
