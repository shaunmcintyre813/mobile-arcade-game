/* ==========================================================================
   ParticleSystem & TraumaShake - AntiGravity: Neon Pulse
   Zero-Allocation Object-Pooled Particle Engine (300 Units)
   Multi-Pass Additive Bloom & Polynomial Trauma Screen Shake
   ========================================================================== */

export const PARTICLE_POOL_SIZE = 300;

export class ParticleSystem {
  /**
   * @param {number} [poolSize=300]
   */
  constructor(poolSize = PARTICLE_POOL_SIZE) {
    this.maxParticles = poolSize;
    this.pool = new Array(this.maxParticles);

    // Strictly pre-allocate all particle objects once to guarantee 0 GC pauses during gameplay
    for (let i = 0; i < this.maxParticles; i++) {
      this.pool[i] = {
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 2,
        baseSize: 2,
        color: '#00F0FF',
        alpha: 1.0,
        decay: 1.0, // Alpha decay rate per second
        shape: 'circle', // 'circle' | 'spark' | 'ring'
        ringRadius: 0,
        ringMaxRadius: 0,
        ringGrowth: 0
      };
    }

    // Integrated polynomial trauma screen shake
    this.trauma = 0; // Clamped to [0, 1]
    this.traumaDecay = 1.4; // Linear trauma decay per second
    this.maxShake = 18; // Max shake displacement in virtual pixels
    this.maxRoll = 0.05; // Max roll in radians (~2.8 degrees)
    this.currentOffset = { x: 0, y: 0, rot: 0 };
  }

  /**
   * Adds trauma to screen shake manager (clamped to 1.0).
   * @param {number} amount
   */
  addTrauma(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  /**
   * Returns the current screen shake offset based on trauma^2.
   * If trauma is 0, offset is strictly { x: 0, y: 0, rot: 0 }.
   * @returns {{ x: number, y: number, rot: number }}
   */
  getShakeOffset() {
    if (this.trauma <= 0) {
      this.currentOffset.x = 0;
      this.currentOffset.y = 0;
      this.currentOffset.rot = 0;
      return this.currentOffset;
    }

    const shakeFactor = this.trauma * this.trauma; // Polynomial trauma (trauma^2)
    const noiseX = Math.random() * 2 - 1;
    const noiseY = Math.random() * 2 - 1;
    const noiseRot = Math.random() * 2 - 1;

    this.currentOffset.x = Math.max(-this.maxShake, Math.min(this.maxShake, shakeFactor * this.maxShake * noiseX));
    this.currentOffset.y = Math.max(-this.maxShake, Math.min(this.maxShake, shakeFactor * this.maxShake * noiseY));
    this.currentOffset.rot = Math.max(-this.maxRoll, Math.min(this.maxRoll, shakeFactor * this.maxRoll * noiseRot));

    return this.currentOffset;
  }

  /**
   * Applies trauma camera shake transform to canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [cx=200] - Center X of virtual viewport
   * @param {number} [cy=444] - Center Y of virtual viewport
   */
  applyShake(ctx, cx = 200, cy = 444) {
    const offset = this.getShakeOffset();
    if (this.trauma > 0) {
      ctx.translate(cx, cy);
      ctx.rotate(offset.rot);
      ctx.translate(-cx + offset.x, -cy + offset.y);
    }
  }

  /**
   * Spawns a burst of particles from the pre-allocated pool without allocating new objects.
   * @param {number} x
   * @param {number} y
   * @param {number} count
   * @param {string} color
   * @param {Object} [options={}]
   * @returns {number} Number of particles actually spawned
   */
  spawnBurst(x, y, count, color = '#00F0FF', options = {}) {
    let spawned = 0;
    const minSpeed = options.minSpeed ?? 60;
    const maxSpeed = options.maxSpeed ?? 320;
    const minSize = options.minSize ?? 2;
    const maxSize = options.maxSize ?? 5;
    const decayRate = options.decayRate ?? 1.8;
    const shape = options.shape ?? 'circle';

    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;

        const angle = Math.random() * Math.PI * 2;
        const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;

        p.baseSize = minSize + Math.random() * (maxSize - minSize);
        p.size = p.baseSize;
        p.color = color;
        p.alpha = 1.0;
        p.decay = decayRate * (0.8 + Math.random() * 0.4);
        p.shape = shape;
        p.ringRadius = 0;
        p.ringMaxRadius = 0;
        p.ringGrowth = 0;

        spawned++;
      }
    }

    return spawned;
  }

  /**
   * Spawns player rail trailing sparks.
   * @param {number} x
   * @param {number} y
   * @param {string} color
   */
  spawnTrail(x, y, color) {
    this.spawnBurst(x, y, 2, color, {
      minSpeed: 10,
      maxSpeed: 40,
      minSize: 1.5,
      maxSize: 3,
      decayRate: 3.5,
      shape: 'spark'
    });
  }

  /**
   * Spawns high-intensity near-miss sparkle burst (Electric Gold #FFE600).
   * @param {number} x
   * @param {number} y
   */
  spawnNearMiss(x, y) {
    this.spawnBurst(x, y, 22, '#FFE600', {
      minSpeed: 120,
      maxSpeed: 400,
      minSize: 2,
      maxSize: 5,
      decayRate: 2.2,
      shape: 'spark'
    });
    this.addTrauma(0.25); // Subtle punchy rumble
  }

  /**
   * Spawns catastrophic game-over explosion with neon shards and expanding shockwave ring.
   * @param {number} x
   * @param {number} y
   */
  spawnExplosion(x, y) {
    // 1. Shards in Cyan, Magenta, Gold, and Pure White
    const colors = ['#00F0FF', '#FF0055', '#FFE600', '#FFFFFF'];
    for (const color of colors) {
      this.spawnBurst(x, y, 15, color, {
        minSpeed: 80,
        maxSpeed: 520,
        minSize: 3,
        maxSize: 7,
        decayRate: 1.2,
        shape: 'circle'
      });
    }

    // 2. Shockwave expanding ring
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = 0;
        p.vy = 0;
        p.color = '#FFFFFF';
        p.alpha = 1.0;
        p.decay = 1.8;
        p.shape = 'ring';
        p.ringRadius = 4;
        p.ringMaxRadius = 160;
        p.ringGrowth = 240;
        break;
      }
    }

    // 3. Heavy impact screen shake
    this.addTrauma(1.0);
  }

  /**
   * Updates all active particles and decays screen shake trauma.
   * @param {number} dt - Fixed delta time
   */
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    // Linear trauma decay
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    }

    // Update active particles
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      if (p.shape === 'ring') {
        p.ringRadius += p.ringGrowth * dt;
        p.alpha -= p.decay * dt;
        if (p.alpha <= 0 || p.ringRadius >= p.ringMaxRadius) {
          p.active = false;
        }
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.98; // Subtle drag
        p.vy *= 0.98;
        p.alpha -= p.decay * dt;
        p.size = Math.max(0.5, p.baseSize * (p.alpha > 0 ? p.alpha : 0));

        if (p.alpha <= 0) {
          p.active = false;
        }
      }
    }
  }

  /**
   * Multi-pass additive rendering of all active particles.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));

      if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, 4 * p.alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.shape === 'spark') {
        // Fast diamond/spark
        ctx.fillStyle = p.color;
        const s = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 1.5);
        ctx.lineTo(p.x + s * 0.8, p.y);
        ctx.lineTo(p.x, p.y + s * 1.5);
        ctx.lineTo(p.x - s * 0.8, p.y);
        ctx.closePath();
        ctx.fill();
      } else {
        // Standard circle particle
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Resets all particles and clears trauma.
   */
  reset() {
    this.trauma = 0;
    this.currentOffset.x = 0;
    this.currentOffset.y = 0;
    this.currentOffset.rot = 0;
    for (let i = 0; i < this.pool.length; i++) {
      this.pool[i].active = false;
    }
  }

  /**
   * Returns count of currently active particles.
   * @returns {number}
   */
  getActiveCount() {
    let count = 0;
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].active) count++;
    }
    return count;
  }
}
