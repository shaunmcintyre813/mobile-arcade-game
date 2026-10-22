import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Player, RAIL_LEFT, RAIL_RIGHT, RAIL_X_LEFT, RAIL_X_RIGHT } from '../../src/player.js';
import { RailSystem, DEFAULT_LEFT_RAIL_X, DEFAULT_RIGHT_RAIL_X } from '../../src/rails.js';
import { Obstacle, ObstacleManager, checkAABB, HAZARD_BARRIER, HAZARD_LASER_GATE, HAZARD_PULSE_NODE, GRAZE_MARGIN_DEFAULT } from '../../src/obstacles.js';
import { ParticleSystem, PARTICLE_POOL_SIZE } from '../../src/particles.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { DisplayManager } from '../../src/display.js';
import { SoundEngine } from '../../src/audio.js';
import { TouchController } from '../../src/touch.js';

// Helper to create mock canvas element for GameEngine unit tests
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
    width: 412,
    height: 915,
    clientWidth: 412,
    clientHeight: 915,
    style: { width: '412px', height: '915px' },
    getContext: vi.fn().mockReturnValue(contextMock),
    getBoundingClientRect: vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      right: 412,
      bottom: 915,
      width: 412,
      height: 915
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
}

describe('Milestone 2: Player Gravity Flip Physics & Micro-Drag Bounds', () => {
  let player;

  beforeEach(() => {
    player = new Player({ leftRailX: 80, rightRailX: 320, y: 650, maxDragOffset: 35 });
  });

  it('initializes at left rail with correct coordinates and hitbox', () => {
    expect(player.currentRail).toBe(RAIL_LEFT);
    expect(player.targetRail).toBe(RAIL_LEFT);
    expect(player.x).toBe(RAIL_X_LEFT);
    expect(player.y).toBe(650);
    expect(player.dragOffset).toBe(0);
    expect(player.isFlipping).toBe(false);

    const hitbox = player.getHitbox();
    expect(hitbox.width).toBe(22);
    expect(hitbox.height).toBe(26);
    expect(hitbox.left).toBe(80 - 11);
    expect(hitbox.right).toBe(80 + 11);
    expect(hitbox.top).toBe(650 - 13);
    expect(hitbox.bottom).toBe(650 + 13);
  });

  it('flipGravity switches target rail from left to right with snappy velocity sweep', () => {
    const nextRail = player.flipGravity();
    expect(nextRail).toBe(RAIL_RIGHT);
    expect(player.targetRail).toBe(RAIL_RIGHT);
    expect(player.isFlipping).toBe(true);
    expect(player.currentColor).toBe('#FF0055'); // Magenta for right rail

    // Step physics forward sub-step by sub-step (120Hz = 1/120s)
    const dt = 1 / 120;
    let prevX = player.x;

    for (let step = 0; step < 10; step++) {
      player.update(dt);
      expect(player.x).toBeGreaterThan(prevX); // Moving rightward
      prevX = player.x;
    }

    // Step for ~0.25 seconds to complete transit
    for (let step = 0; step < 30; step++) {
      player.update(dt);
    }

    expect(player.x).toBeCloseTo(RAIL_X_RIGHT, 0);
    expect(player.currentRail).toBe(RAIL_RIGHT);
    expect(player.isFlipping).toBe(false);
  });

  it('flipGravity switches target rail back from right to left smoothly', () => {
    // Start on right rail
    player.flipGravity();
    const dt = 1 / 120;
    for (let i = 0; i < 40; i++) player.update(dt);
    expect(player.currentRail).toBe(RAIL_RIGHT);

    // Flip back to left
    const returnRail = player.flipGravity();
    expect(returnRail).toBe(RAIL_LEFT);
    expect(player.targetRail).toBe(RAIL_LEFT);
    expect(player.currentColor).toBe('#00F0FF'); // Cyan for left rail

    for (let i = 0; i < 40; i++) player.update(dt);
    expect(player.x).toBeCloseTo(RAIL_X_LEFT, 0);
    expect(player.currentRail).toBe(RAIL_LEFT);
  });

  it('thumb micro-drag clamps strictly within safe rail bounds [-maxDragOffset, +maxDragOffset]', () => {
    expect(player.dragOffset).toBe(0);

    // Small valid micro-drag
    player.applyMicroDrag(15);
    expect(player.dragOffset).toBe(15);

    // Further micro-drag exceeding positive bound
    player.applyMicroDrag(50);
    expect(player.dragOffset).toBe(35); // Clamped to +35

    // Negative micro-drag exceeding negative bound
    player.applyMicroDrag(-100);
    expect(player.dragOffset).toBe(-35); // Clamped to -35

    // setMicroDrag direct setter
    player.setMicroDrag(20);
    expect(player.dragOffset).toBe(20);
    player.setMicroDrag(999);
    expect(player.dragOffset).toBe(35);
    player.setMicroDrag(-999);
    expect(player.dragOffset).toBe(-35);

    // Non-finite values are safely rejected
    player.applyMicroDrag(NaN);
    expect(player.dragOffset).toBe(-35);
    player.setMicroDrag(Infinity);
    expect(player.dragOffset).toBe(-35);
  });

  it('flipping gravity resets micro-drag offset to prevent drift across lanes', () => {
    player.applyMicroDrag(25);
    expect(player.dragOffset).toBe(25);

    player.flipGravity();
    expect(player.dragOffset).toBe(0);
  });

  it('reset returns player to clean initial state', () => {
    player.flipGravity();
    player.applyMicroDrag(20);
    player.update(1 / 120);

    player.reset(700);
    expect(player.currentRail).toBe(RAIL_LEFT);
    expect(player.targetRail).toBe(RAIL_LEFT);
    expect(player.x).toBe(RAIL_X_LEFT);
    expect(player.y).toBe(700);
    expect(player.dragOffset).toBe(0);
    expect(player.isFlipping).toBe(false);
  });
});

describe('Milestone 2: Obstacle Collision Detection (Lethal vs Near-Miss Graze Margin)', () => {
  let obstacle;

  beforeEach(() => {
    // Barrier centered at x=80, y=500, width=64, height=22, grazeMargin=20
    obstacle = new Obstacle({
      type: HAZARD_BARRIER,
      x: 80,
      y: 500,
      width: 64,
      height: 22,
      grazeMargin: 20
    });
  });

  it('computes lethal hitbox and expanded +20px near-miss graze hitbox accurately', () => {
    const lethal = obstacle.getLethalHitbox();
    // width=64, half=32 -> [48, 112]
    // height=22, half=11 -> [489, 511]
    expect(lethal.left).toBe(48);
    expect(lethal.right).toBe(112);
    expect(lethal.top).toBe(489);
    expect(lethal.bottom).toBe(511);

    const graze = obstacle.getGrazeHitbox();
    // +20 margin on all sides -> left: 28, right: 132, top: 469, bottom: 531
    expect(graze.left).toBe(28);
    expect(graze.right).toBe(132);
    expect(graze.top).toBe(469);
    expect(graze.bottom).toBe(531);
    expect(graze.width).toBe(64 + 40);
    expect(graze.height).toBe(22 + 40);
  });

  it('detects lethal collision when player overlaps lethal hitbox', () => {
    const manager = new ObstacleManager();
    manager.obstacles = [obstacle];

    // Player positioned directly inside lethal box (x=80, y=500, w=22, h=26 -> left=69, right=91, top=487, bottom=513)
    const mockPlayer = {
      getHitbox: () => ({ left: 69, right: 91, top: 487, bottom: 513 })
    };

    const result = manager.checkCollisions(mockPlayer);
    expect(result.lethal).toBe(true);
    expect(result.lethalObstacle).toBe(obstacle);
    expect(result.nearMisses.length).toBe(0);
  });

  it('triggers near-miss hypercharge when player grazes within +20px margin without lethal overlap', () => {
    const manager = new ObstacleManager();
    manager.obstacles = [obstacle];

    // Player positioned laterally just outside lethal box [48, 112] but inside graze box [28, 132]
    // Player at x=122, w=10 -> [117, 127], y=500 -> [495, 505]
    const mockPlayer = {
      getHitbox: () => ({ left: 117, right: 127, top: 495, bottom: 505 })
    };

    const result = manager.checkCollisions(mockPlayer);
    expect(result.lethal).toBe(false);
    expect(result.lethalObstacle).toBeNull();
    expect(result.nearMisses.length).toBe(1);
    expect(result.nearMisses[0]).toBe(obstacle);
    expect(obstacle.grazed).toBe(true);

    // Second check should not re-trigger near-miss (single-trigger guarantee)
    const secondResult = manager.checkCollisions(mockPlayer);
    expect(secondResult.lethal).toBe(false);
    expect(secondResult.nearMisses.length).toBe(0);
  });

  it('does not trigger collision or graze when player is far away (e.g. on opposite rail)', () => {
    const manager = new ObstacleManager();
    manager.obstacles = [obstacle];

    // Player on right rail (x=320, y=500)
    const mockPlayer = {
      getHitbox: () => ({ left: 309, right: 331, top: 487, bottom: 513 })
    };

    const result = manager.checkCollisions(mockPlayer);
    expect(result.lethal).toBe(false);
    expect(result.lethalObstacle).toBeNull();
    expect(result.nearMisses.length).toBe(0);
  });

  it('procedural obstacle generation creates solvable tracks and scrolls downward', () => {
    const manager = new ObstacleManager({ leftRailX: 80, rightRailX: 320 });
    expect(manager.obstacles.length).toBe(0);

    // Simulate 2 seconds of gameplay to trigger spawns
    const dt = 1 / 120;
    for (let i = 0; i < 240; i++) {
      manager.update(dt, 900);
    }

    expect(manager.obstacles.length).toBeGreaterThan(0);
    expect(manager.distanceTraveled).toBeGreaterThan(0);
    expect(manager.currentSpeed).toBeGreaterThanOrEqual(manager.baseSpeed);

    // Check that obstacles are scrolling downward
    const firstObs = manager.obstacles[0];
    const initialY = firstObs.y;
    manager.update(0.1, 900);
    expect(firstObs.y).toBeGreaterThan(initialY);
  });
});

describe('Milestone 2: Particle Pool Recycling & Zero-Allocation Guarantee', () => {
  let particleSys;

  beforeEach(() => {
    particleSys = new ParticleSystem(300);
  });

  it('initializes exactly 300 pre-allocated particle instances with active=false', () => {
    expect(particleSys.pool.length).toBe(PARTICLE_POOL_SIZE);
    expect(particleSys.getActiveCount()).toBe(0);

    for (let i = 0; i < particleSys.pool.length; i++) {
      const p = particleSys.pool[i];
      expect(p.active).toBe(false);
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(typeof p.vx).toBe('number');
      expect(typeof p.vy).toBe('number');
    }
  });

  it('spawnBurst activates inactive particles from pool and returns spawned count', () => {
    const spawned = particleSys.spawnBurst(200, 400, 30, '#00F0FF');
    expect(spawned).toBe(30);
    expect(particleSys.getActiveCount()).toBe(30);
    expect(particleSys.pool.length).toBe(PARTICLE_POOL_SIZE); // Array size unchanged
  });

  it('particles decay over time and automatically return to inactive pool', () => {
    particleSys.spawnBurst(200, 400, 10, '#00F0FF', { decayRate: 5.0 });
    expect(particleSys.getActiveCount()).toBe(10);

    // Step forward 1.0 second (well past decay threshold of 5.0/sec)
    particleSys.update(1.0);
    expect(particleSys.getActiveCount()).toBe(0);
  });

  it('maintains strict zero-allocation guarantee under heavy burst spam', () => {
    const poolReference = particleSys.pool;

    // Heavy load test: trigger 1,000 bursts exceeding pool capacity
    for (let i = 0; i < 50; i++) {
      particleSys.spawnBurst(200, 400, 50, '#FF0055');
      particleSys.spawnNearMiss(80, 500);
      particleSys.spawnTrail(80, 650, '#00F0FF');
      particleSys.update(0.016);
    }

    // Array identity and size must be strictly preserved
    expect(particleSys.pool).toBe(poolReference);
    expect(particleSys.pool.length).toBe(PARTICLE_POOL_SIZE);
    expect(particleSys.getActiveCount()).toBeLessThanOrEqual(PARTICLE_POOL_SIZE);
  });

  it('spawnNearMiss and spawnExplosion configure correct visual properties and trauma', () => {
    particleSys.spawnNearMiss(100, 200);
    expect(particleSys.trauma).toBeGreaterThan(0);
    expect(particleSys.getActiveCount()).toBeGreaterThan(0);

    particleSys.reset();
    expect(particleSys.getActiveCount()).toBe(0);
    expect(particleSys.trauma).toBe(0);

    particleSys.spawnExplosion(200, 300);
    expect(particleSys.trauma).toBe(1.0); // Maximum trauma on catastrophic crash
    expect(particleSys.getActiveCount()).toBeGreaterThan(40);
  });
});

describe('Milestone 2: Polynomial Trauma Decay & Screen Shake Limits', () => {
  let particleSys;

  beforeEach(() => {
    particleSys = new ParticleSystem();
  });

  it('trauma of 0 produces strictly zero screen shake offset', () => {
    expect(particleSys.trauma).toBe(0);
    const offset = particleSys.getShakeOffset();
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.rot).toBe(0);
  });

  it('addTrauma clamps strictly to 1.0', () => {
    particleSys.addTrauma(0.4);
    expect(particleSys.trauma).toBeCloseTo(0.4, 4);

    particleSys.addTrauma(0.8);
    expect(particleSys.trauma).toBe(1.0); // Clamped to max 1.0

    particleSys.addTrauma(999);
    expect(particleSys.trauma).toBe(1.0);

    // Non-finite or negative values are safely ignored
    particleSys.addTrauma(NaN);
    expect(particleSys.trauma).toBe(1.0);
    particleSys.addTrauma(-0.5);
    expect(particleSys.trauma).toBe(1.0);
  });

  it('screen shake offsets are bounded by maxShake and scale quadratically (trauma^2)', () => {
    particleSys.trauma = 0.5; // Half trauma
    // At trauma 0.5, shakeFactor is 0.25 (trauma^2)
    // maxShake = 18, so offset magnitude <= 0.25 * 18 = 4.5
    for (let i = 0; i < 50; i++) {
      const offset = particleSys.getShakeOffset();
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(4.5001);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(4.5001);
      expect(Math.abs(offset.rot)).toBeLessThanOrEqual(particleSys.maxRoll);
    }

    // At full trauma 1.0, offset magnitude <= 18
    particleSys.trauma = 1.0;
    for (let i = 0; i < 50; i++) {
      const offset = particleSys.getShakeOffset();
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(particleSys.maxShake);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(particleSys.maxShake);
    }
  });

  it('trauma decays linearly over time and reaches zero', () => {
    particleSys.trauma = 0.7;
    particleSys.traumaDecay = 1.4; // 1.4 units/sec

    // Step 0.25 seconds: 0.7 - (1.4 * 0.25) = 0.35
    particleSys.update(0.25);
    expect(particleSys.trauma).toBeCloseTo(0.35, 4);

    // Step another 0.3 seconds: 0.35 - (1.4 * 0.3) = -0.07 -> clamped to 0
    particleSys.update(0.3);
    expect(particleSys.trauma).toBe(0);
  });
});

describe('Milestone 2: 120Hz Fixed Timestep Accumulator Loop', () => {
  it('fixed timestep sub-steps at 1/120s (8.333ms)', () => {
    const canvas = createMockCanvas();
    const game = new GameEngine(canvas);

    let updateCount = 0;
    game.update = () => {
      updateCount++;
    };

    // Feed a delta of 25ms (0.025s) -> exactly 3 sub-steps (3 * 8.333ms = 25ms)
    game.lastTime = 1000;
    game.running = true;
    game.tick(1025);

    expect(updateCount).toBe(3);
    expect(game.accumulatedTime).toBeLessThan(game.fixedTimeStep);
  });

  it('clamps accumulator to 0.1s during massive frame hitch to prevent spiral of death', () => {
    const canvas = createMockCanvas();
    const game = new GameEngine(canvas);

    let updateCount = 0;
    game.update = () => {
      updateCount++;
    };

    // Simulate 2-second frame hitch (e.g. mobile tab suspended)
    game.lastTime = 1000;
    game.running = true;
    game.tick(3000); // 2000ms delta

    // Clamped to 0.1s -> max sub-steps = floor(0.1 / (1/120)) = 12
    expect(updateCount).toBe(12);
    expect(updateCount).toBeLessThan(15);
  });

  it('buffers small deltas (<8.33ms) until threshold is met', () => {
    const canvas = createMockCanvas();
    const game = new GameEngine(canvas);

    let updateCount = 0;
    game.update = () => {
      updateCount++;
    };

    game.lastTime = 1000;
    game.running = true;

    // Step 1: 4ms -> 0 sub-steps
    game.tick(1004);
    expect(updateCount).toBe(0);
    expect(game.accumulatedTime).toBeCloseTo(0.004, 4);

    // Step 2: another 5ms (total 9ms > 8.333ms) -> 1 sub-step
    game.tick(1009);
    expect(updateCount).toBe(1);
    expect(game.accumulatedTime).toBeCloseTo(0.009 - 1 / 120, 4);
  });
});

describe('Milestone 2: Game State Machine & Transitions', () => {
  let canvas;
  let game;

  beforeEach(() => {
    canvas = createMockCanvas();
    game = new GameEngine(canvas);
  });

  it('begins in START state', () => {
    expect(game.state).toBe(STATE_START);
    expect(game.score).toBe(0);
    expect(game.comboMultiplier).toBe(1);
  });

  it('transitions from START to PLAYING on tap', () => {
    expect(game.state).toBe(STATE_START);
    game.handleTap();
    expect(game.state).toBe(STATE_PLAYING);
  });

  it('inverts gravity on tap while in PLAYING state', () => {
    game.startPlaying();
    expect(game.player.currentRail).toBe(RAIL_LEFT);

    game.handleTap();
    expect(game.player.targetRail).toBe(RAIL_RIGHT);
    expect(game.player.isFlipping).toBe(true);
  });

  it('transitions to GAME_OVER on lethal obstacle collision', () => {
    game.startPlaying();
    expect(game.state).toBe(STATE_PLAYING);

    // Spawn obstacle directly colliding with player
    const lethalObs = new Obstacle({
      type: HAZARD_BARRIER,
      x: game.player.x,
      y: game.player.y,
      width: 50,
      height: 30
    });
    game.obstacles.obstacles = [lethalObs];

    // Physics update detects collision
    game.update(1 / 120);

    expect(game.state).toBe(STATE_GAME_OVER);
    expect(game.particles.trauma).toBe(1.0); // Catastrophic shockwave
  });

  it('reset returns game to clean state ready for replay', () => {
    game.startPlaying();
    game.score = 500;
    game.comboMultiplier = 4;
    game.triggerGameOver();

    expect(game.state).toBe(STATE_GAME_OVER);

    game.reset();
    expect(game.score).toBe(0);
    expect(game.comboMultiplier).toBe(1);
    expect(game.player.x).toBe(RAIL_X_LEFT);
    expect(game.obstacles.obstacles.length).toBe(0);

    game.startPlaying();
    expect(game.state).toBe(STATE_PLAYING);
  });
});

describe('Milestone 2: RailSystem Rendering & Speed Lines', () => {
  it('initializes twin cyber-rails at 80 and 320 with pre-allocated speed lines', () => {
    const rails = new RailSystem();
    expect(rails.leftX).toBe(DEFAULT_LEFT_RAIL_X);
    expect(rails.rightX).toBe(DEFAULT_RIGHT_RAIL_X);
    expect(rails.speedLines.length).toBe(40);
  });

  it('update advances grid offset and wraps speed lines at virtualHeight', () => {
    const rails = new RailSystem();
    const initialGridOffset = rails.gridOffset;

    rails.update(1 / 120, 360, 900);
    expect(rails.gridOffset).toBeGreaterThan(initialGridOffset);

    // Place a speed line far down screen to verify wrapping
    rails.speedLines[0].y = 960;
    rails.update(1 / 120, 360, 900);
    expect(rails.speedLines[0].y).toBeLessThan(0); // Wrapped above screen
  });
});
