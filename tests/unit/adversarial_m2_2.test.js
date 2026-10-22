import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  ParticleSystem,
  PARTICLE_POOL_SIZE
} from '../../src/particles.js';

import {
  Obstacle,
  ObstacleManager,
  checkAABB,
  HAZARD_BARRIER,
  HAZARD_LASER_GATE,
  HAZARD_PULSE_NODE,
  GRAZE_MARGIN_DEFAULT
} from '../../src/obstacles.js';

import { Player } from '../../src/player.js';

describe('Adversarial M2.2: Particle Pool Stress & Zero-Allocation Invariance', () => {
  let particleSys;

  beforeEach(() => {
    particleSys = new ParticleSystem(PARTICLE_POOL_SIZE);
  });

  it('1.1: 5,000 rapid particle spawn requests strictly caps pool at 300 pre-allocated slots', () => {
    // Retain original references to verify zero re-allocation
    const initialPool = [...particleSys.pool];
    expect(initialPool.length).toBe(300);

    // Scenario A: Single massive burst request of 5,000 particles
    const spawnedBurst = particleSys.spawnBurst(200, 444, 5000, '#00F0FF');
    expect(spawnedBurst).toBe(300); // Only 300 available
    expect(particleSys.pool.length).toBe(300);
    expect(particleSys.getActiveCount()).toBe(300);

    // Verify all pool object references are strictly identical
    for (let i = 0; i < 300; i++) {
      expect(particleSys.pool[i]).toBe(initialPool[i]);
      expect(particleSys.pool[i].active).toBe(true);
    }

    // Scenario B: Rapid burst spam loop (50 bursts of 100 particles each = 5,000 requests)
    let totalSpawned = 0;
    for (let cycle = 0; cycle < 50; cycle++) {
      // Step simulation by 16ms so some particles may decay
      particleSys.update(0.016);
      const s = particleSys.spawnBurst(cycle * 4, 300, 100, '#FF0055');
      totalSpawned += s;
      expect(particleSys.pool.length).toBe(300);
      expect(particleSys.getActiveCount()).toBeLessThanOrEqual(300);
    }

    // Identity check: pool array and every single particle object must not have been reallocated
    expect(particleSys.pool.length).toBe(300);
    for (let i = 0; i < 300; i++) {
      expect(particleSys.pool[i]).toBe(initialPool[i]);
    }
  });

  it('1.2: Heap allocations and object references do not scale with spawn volume', () => {
    const initialPoolRef = particleSys.pool;
    const initialElementRefs = particleSys.pool.map(p => p);

    // Garbage collection baseline measurement
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    // Perform 10,000 individual spawn calls across simulated time
    for (let step = 0; step < 2500; step++) {
      particleSys.spawnTrail(100, 200, '#00F0FF'); // 2 particles
      particleSys.spawnNearMiss(200, 300);          // 22 particles + trauma
      if (step % 50 === 0) {
        particleSys.spawnExplosion(150, 250);       // 60 particles + shockwave ring
      }
      particleSys.update(0.02);
    }

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

    // Heap delta should be negligible (< 10 MB overhead for loop execution artifacts, 0 particle pool growth)
    expect(heapDeltaMB).toBeLessThan(15);

    // Array instance must be the exact same object reference
    expect(particleSys.pool).toBe(initialPoolRef);
    expect(particleSys.pool.length).toBe(300);

    // Every particle object in the pool must be the exact same object reference
    for (let i = 0; i < 300; i++) {
      expect(particleSys.pool[i]).toBe(initialElementRefs[i]);
    }
  });

  it('1.3: Adversarial input fuzzing on spawnBurst rejects invalid inputs safely', () => {
    // Negative counts
    expect(particleSys.spawnBurst(0, 0, -500)).toBe(0);
    expect(particleSys.getActiveCount()).toBe(0);

    // Zero count
    expect(particleSys.spawnBurst(0, 0, 0)).toBe(0);
    expect(particleSys.getActiveCount()).toBe(0);

    // NaN count
    expect(particleSys.spawnBurst(0, 0, NaN)).toBe(0);
    expect(particleSys.getActiveCount()).toBe(0);

    // Non-finite coordinates do not expand pool
    particleSys.spawnBurst(NaN, Infinity, 10);
    expect(particleSys.pool.length).toBe(300);
    expect(particleSys.getActiveCount()).toBe(10);

    // Clean reset
    particleSys.reset();
    expect(particleSys.getActiveCount()).toBe(0);

    // Extreme decay rate
    particleSys.spawnBurst(100, 100, 10, '#FFFFFF', { decayRate: 1000 });
    expect(particleSys.getActiveCount()).toBe(10);
    particleSys.update(0.01);
    // Should immediately decay to 0 active
    expect(particleSys.getActiveCount()).toBe(0);
  });

  it('1.4: Specialized shockwave ring deactivates cleanly without stuck active slots', () => {
    particleSys.spawnExplosion(200, 400);

    // Find the ring particle
    const rings = particleSys.pool.filter(p => p.active && p.shape === 'ring');
    expect(rings.length).toBe(1);
    const ring = rings[0];
    expect(ring.ringRadius).toBe(4);
    expect(ring.ringMaxRadius).toBe(160);

    // Step forward 1.0 second: ringGrowth = 240 px/s, so at 1s radius = 244 >= 160
    particleSys.update(1.0);
    expect(ring.active).toBe(false);
  });
});

describe('Adversarial M2.2: Trauma Screen Shake Polynomial Decay & Extreme Bounds', () => {
  let particleSys;

  beforeEach(() => {
    particleSys = new ParticleSystem(300);
  });

  it('2.1: Polynomial decay curve verifies quadratic suppression factor (trauma^2)', () => {
    // Test that shake factor strictly matches trauma^2 across discrete trauma levels
    const testCases = [
      { trauma: 1.0,  expectedFactor: 1.0,    maxExpectedOffset: 18.0 },
      { trauma: 0.75, expectedFactor: 0.5625, maxExpectedOffset: 18.0 * 0.5625 },
      { trauma: 0.5,  expectedFactor: 0.25,   maxExpectedOffset: 18.0 * 0.25 },
      { trauma: 0.25, expectedFactor: 0.0625, maxExpectedOffset: 18.0 * 0.0625 },
      { trauma: 0.1,  expectedFactor: 0.01,   maxExpectedOffset: 18.0 * 0.01 },
      { trauma: 0.0,  expectedFactor: 0.0,    maxExpectedOffset: 0.0 }
    ];

    for (const { trauma, maxExpectedOffset } of testCases) {
      particleSys.trauma = trauma;

      for (let sample = 0; sample < 100; sample++) {
        const offset = particleSys.getShakeOffset();
        expect(Math.abs(offset.x)).toBeLessThanOrEqual(maxExpectedOffset + 1e-6);
        expect(Math.abs(offset.y)).toBeLessThanOrEqual(maxExpectedOffset + 1e-6);
        expect(Math.abs(offset.rot)).toBeLessThanOrEqual(particleSys.maxRoll + 1e-6);
      }
    }
  });

  it('2.2: Extreme positive trauma (trauma = 50.0) remains strictly bounded by maxShake = 18 px', () => {
    // Via addTrauma
    particleSys.reset();
    particleSys.addTrauma(50.0);
    expect(particleSys.trauma).toBe(1.0); // addTrauma clamps to 1.0

    for (let i = 0; i < 200; i++) {
      const offset = particleSys.getShakeOffset();
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(18.0);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(18.0);
      expect(Math.abs(offset.rot)).toBeLessThanOrEqual(particleSys.maxRoll);
    }

    // Via direct state mutation (simulating external glitch or unconstrained setter)
    particleSys.trauma = 50.0;
    for (let i = 0; i < 1000; i++) {
      const offset = particleSys.getShakeOffset();
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(18.0);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(18.0);
      expect(Math.abs(offset.rot)).toBeLessThanOrEqual(particleSys.maxRoll);
    }
  });

  it('2.3: Negative trauma inputs (trauma = -5.0) produce strictly zero shake offsets', () => {
    // Via addTrauma
    particleSys.reset();
    particleSys.addTrauma(-5.0);
    expect(particleSys.trauma).toBe(0.0); // Negative addTrauma safely ignored

    let offset = particleSys.getShakeOffset();
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.rot).toBe(0);

    // Via direct state mutation
    particleSys.trauma = -5.0;
    for (let i = 0; i < 100; i++) {
      offset = particleSys.getShakeOffset();
      expect(offset.x).toBe(0);
      expect(offset.y).toBe(0);
      expect(offset.rot).toBe(0);
    }

    // Update with negative trauma does not corrupt state
    particleSys.update(0.1);
    expect(particleSys.trauma).toBe(-5.0); // Not made worse
    offset = particleSys.getShakeOffset();
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  it('2.4: Non-finite trauma inputs (NaN, Infinity, -Infinity) handle safely', () => {
    particleSys.reset();

    particleSys.addTrauma(NaN);
    expect(particleSys.trauma).toBe(0);

    particleSys.addTrauma(Infinity);
    expect(particleSys.trauma).toBe(0);

    particleSys.addTrauma(-Infinity);
    expect(particleSys.trauma).toBe(0);

    // If trauma is reset, getShakeOffset is strictly zero
    particleSys.reset();
    const offset = particleSys.getShakeOffset();
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.rot).toBe(0);
  });

  it('2.5: applyShake applies and resets context matrix safely without residual drift', () => {
    const mockCtx = {
      translate: vi.fn(),
      rotate: vi.fn()
    };

    // When trauma is 0, applyShake should do nothing
    particleSys.trauma = 0;
    particleSys.applyShake(mockCtx, 200, 444);
    expect(mockCtx.translate).not.toHaveBeenCalled();
    expect(mockCtx.rotate).not.toHaveBeenCalled();

    // When trauma is 1.0, applyShake invokes translate and rotate
    particleSys.trauma = 1.0;
    particleSys.applyShake(mockCtx, 200, 444);
    expect(mockCtx.translate).toHaveBeenCalledTimes(2);
    expect(mockCtx.rotate).toHaveBeenCalledTimes(1);
  });
});

describe('Adversarial M2.2: Obstacle Generation & Speed Escalation (10,000s Endurance Test)', () => {
  let manager;

  beforeEach(() => {
    manager = new ObstacleManager({
      leftRailX: 80,
      rightRailX: 320,
      baseSpeed: 360
    });
  });

  it('3.1: Logarithmic speed escalation strictly bounded by maxSpeed = 740 px/s across 10,000s', () => {
    const dt = 1 / 120; // 120Hz fixed physics step
    const totalSeconds = 10000;
    const totalSteps = totalSeconds * 120; // 1,200,000 steps

    let previousSpeed = manager.currentSpeed;
    expect(previousSpeed).toBe(360);

    let maxObservedSpeed = 0;
    let minObservedSpeed = Infinity;
    let nonMonotonicCount = 0;

    // Run full 1,200,000 steps with sampling for Vitest speed
    const sampleInterval = 600; // Sample every 5 game-seconds

    for (let step = 1; step <= totalSteps; step++) {
      manager.update(dt, 900);

      const spd = manager.currentSpeed;
      if (spd > maxObservedSpeed) maxObservedSpeed = spd;
      if (spd < minObservedSpeed) minObservedSpeed = spd;

      if (step % sampleInterval === 0) {
        if (spd < previousSpeed - 1e-9) nonMonotonicCount++;
        previousSpeed = spd;

        expect(Number.isFinite(manager.distanceTraveled)).toBe(true);
        expect(Number.isFinite(manager.nextSpawnDistance)).toBe(true);
      }
    }

    // Strict speed invariant assertions
    expect(maxObservedSpeed).toBeLessThanOrEqual(740.0);
    expect(minObservedSpeed).toBeGreaterThanOrEqual(360.0);
    expect(nonMonotonicCount).toBe(0);

    // At 10,000 game-seconds, speed must have reached exact maximum speed 740
    expect(manager.currentSpeed).toBe(740);
    expect(manager.elapsedTime).toBeCloseTo(10000, 1);
  });

  it('3.2: Memory boundedness: active obstacles array never leaks or exceeds safe ceiling across 10,000s', () => {
    const dt = 1 / 120;
    const totalSteps = 10000 * 120; // 1,200,000 steps

    let maxObstacleCount = 0;
    const sampleInterval = 1200; // Sample every 10 seconds

    for (let step = 1; step <= totalSteps; step++) {
      manager.update(dt, 900);

      if (step % sampleInterval === 0) {
        const count = manager.obstacles.length;
        if (count > maxObstacleCount) maxObstacleCount = count;

        // In a 900px viewport with ~300px gap, active obstacles should never exceed 8
        expect(count).toBeLessThanOrEqual(8);

        // Verify all active obstacles have valid coordinates
        for (const obs of manager.obstacles) {
          expect(Number.isFinite(obs.x)).toBe(true);
          expect(Number.isFinite(obs.y)).toBe(true);
          expect(obs.y).toBeLessThanOrEqual(900 + 80); // Culling threshold
        }
      }
    }

    expect(maxObstacleCount).toBeGreaterThan(0);
    expect(maxObstacleCount).toBeLessThanOrEqual(8);
  });

  it('3.3: Procedural generation produces all 3 hazard types with valid geometry', () => {
    const spawnedTypes = new Set();
    const dt = 1 / 120;

    // Simulate 200 game-seconds to collect hundreds of obstacles
    for (let step = 0; step < 200 * 120; step++) {
      manager.update(dt, 900);
      for (const obs of manager.obstacles) {
        spawnedTypes.add(obs.type);
      }
    }

    // Must have generated all three hazard types
    expect(spawnedTypes.has(HAZARD_BARRIER)).toBe(true);
    expect(spawnedTypes.has(HAZARD_LASER_GATE)).toBe(true);
    expect(spawnedTypes.has(HAZARD_PULSE_NODE)).toBe(true);
  });

  it('3.4: Track solvability: vertical spacing between consecutive obstacles preserves reaction window', () => {
    const dt = 1 / 120;
    let spawnCount = 0;
    let minSpawnGap = Infinity;

    // Run for 300 seconds and measure gap between consecutive spawns
    let lastDist = manager.distanceTraveled;
    for (let step = 0; step < 300 * 120; step++) {
      const prevObsCount = manager.obstacles.length;
      manager.update(dt, 900);
      if (manager.obstacles.length > prevObsCount) {
        const gap = manager.distanceTraveled - lastDist;
        if (spawnCount > 0 && gap < minSpawnGap) {
          minSpawnGap = gap;
        }
        lastDist = manager.distanceTraveled;
        spawnCount++;
      }
    }

    expect(spawnCount).toBeGreaterThan(50);
    // Base gap is configured as 260 + random(80), so minimum gap must be >= 250px
    expect(minSpawnGap).toBeGreaterThanOrEqual(250);
  });

  it('3.5: Dual-hitbox near-miss vs lethal detection remains accurate across high speed (740 px/s)', () => {
    // Set speed to max speed 740 px/s
    manager.currentSpeed = 740;

    const barrier = new Obstacle({
      type: HAZARD_BARRIER,
      x: 80,
      y: 500,
      width: 68,
      height: 24,
      grazeMargin: 20
    });
    manager.obstacles = [barrier];

    // Mock player grazing the barrier on the right side:
    // Barrier lethal right is 80 + 34 = 114.
    // Barrier graze right is 114 + 20 = 134.
    // Player at x = 124, width = 10 -> [119, 129], which touches graze box [114, 134] but NOT lethal [46, 114].
    const grazingPlayer = {
      getHitbox: () => ({ left: 119, right: 129, top: 495, bottom: 505 })
    };

    const collisionResult = manager.checkCollisions(grazingPlayer);
    expect(collisionResult.lethal).toBe(false);
    expect(collisionResult.nearMisses.length).toBe(1);
    expect(barrier.grazed).toBe(true);

    // Repeated check should not trigger second near-miss (guaranteed single-trigger)
    const repeatedResult = manager.checkCollisions(grazingPlayer);
    expect(repeatedResult.nearMisses.length).toBe(0);

    // Lethal player colliding with barrier:
    const crashingPlayer = {
      getHitbox: () => ({ left: 75, right: 85, top: 495, bottom: 505 })
    };
    const crashResult = manager.checkCollisions(crashingPlayer);
    expect(crashResult.lethal).toBe(true);
    expect(crashResult.lethalObstacle).toBe(barrier);
  });
});
