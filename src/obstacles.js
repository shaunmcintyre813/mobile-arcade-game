/* ==========================================================================
   ObstacleManager - AntiGravity: Neon Pulse
   Procedural Scrolling Obstacles, Dual-Hitbox Detection & Near-Miss Engine
   Lethal Hitbox vs +20px Near-Miss Graze Margin
   ========================================================================== */

export const HAZARD_BARRIER = 'barrier';
export const HAZARD_LASER_GATE = 'laser_gate';
export const HAZARD_PULSE_NODE = 'pulse_node';

export const GRAZE_MARGIN_DEFAULT = 20;

/**
 * Axis-Aligned Bounding Box (AABB) intersection check.
 * @param {{ left: number, right: number, top: number, bottom: number }} a
 * @param {{ left: number, right: number, top: number, bottom: number }} b
 * @returns {boolean}
 */
export function checkAABB(a, b) {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

export class Obstacle {
  /**
   * @param {Object} config
   * @param {string} config.type - 'barrier' | 'laser_gate' | 'pulse_node'
   * @param {number} config.x - Virtual X center
   * @param {number} config.y - Virtual Y center
   * @param {number} config.width
   * @param {number} config.height
   * @param {number} [config.grazeMargin=20]
   * @param {string} [config.color='#FF3344']
   * @param {number} [config.oscAmplitude=0]
   * @param {number} [config.oscSpeed=0]
   */
  constructor(config) {
    this.type = config.type || HAZARD_BARRIER;
    this.x = config.x ?? 80;
    this.y = config.y ?? -50;
    this.baseX = this.x;
    this.width = config.width ?? 64;
    this.height = config.height ?? 22;
    this.grazeMargin = config.grazeMargin ?? GRAZE_MARGIN_DEFAULT;
    this.color = config.color || (this.type === HAZARD_PULSE_NODE ? '#FFAA00' : '#FF3344');

    // Oscillation for moving laser gates
    this.oscAmplitude = config.oscAmplitude ?? 0;
    this.oscSpeed = config.oscSpeed ?? 0;
    this.oscTime = Math.random() * Math.PI * 2;

    // State tracking
    this.grazed = false;
    this.cleared = false;
    this.rotation = 0;
  }

  /**
   * Returns the lethal collision hitbox.
   * @returns {{ left: number, right: number, top: number, bottom: number, x: number, y: number, width: number, height: number }}
   */
  getLethalHitbox() {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    return {
      left: this.x - halfW,
      right: this.x + halfW,
      top: this.y - halfH,
      bottom: this.y + halfH,
      x: this.x - halfW,
      y: this.y - halfH,
      width: this.width,
      height: this.height
    };
  }

  /**
   * Returns the expanded near-miss graze hitbox (+20px margin).
   * @returns {{ left: number, right: number, top: number, bottom: number, x: number, y: number, width: number, height: number }}
   */
  getGrazeHitbox() {
    const lethal = this.getLethalHitbox();
    const m = this.grazeMargin;
    return {
      left: lethal.left - m,
      right: lethal.right + m,
      top: lethal.top - m,
      bottom: lethal.bottom + m,
      x: lethal.x - m,
      y: lethal.y - m,
      width: lethal.width + m * 2,
      height: lethal.height + m * 2
    };
  }

  /**
   * Updates obstacle motion.
   * @param {number} dt - Fixed delta time
   * @param {number} speed - Current downward scroll speed
   */
  update(dt, speed) {
    this.y += speed * dt;

    if (this.oscAmplitude > 0 && this.oscSpeed > 0) {
      this.oscTime += dt * this.oscSpeed;
      this.x = this.baseX + Math.sin(this.oscTime) * this.oscAmplitude;
    }

    if (this.type === HAZARD_PULSE_NODE) {
      this.rotation += dt * 3.5;
    }
  }

  /**
   * Renders the hazard with cyberpunk neon warning styling.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    ctx.save();
    const halfW = this.width / 2;
    const halfH = this.height / 2;

    if (this.type === HAZARD_PULSE_NODE) {
      // Rotating diamond pulse hazard
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);

      ctx.fillStyle = this.color;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(0, -halfH);
      ctx.lineTo(halfW, 0);
      ctx.lineTo(0, halfH);
      ctx.lineTo(-halfW, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Outer hazard ring
      ctx.strokeStyle = this.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, halfW * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.type === HAZARD_LASER_GATE) {
      // High-intensity laser gate with emitter endpoints
      ctx.translate(this.x, this.y);

      // Pass 1: Diffuse glow
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 8;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(-halfW, 0);
      ctx.lineTo(halfW, 0);
      ctx.stroke();

      // Pass 2: Bright laser beam
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      // Pass 3: White center laser line
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 1.0;
      ctx.stroke();

      // Emitter nodes at left and right edges
      ctx.fillStyle = '#FFAA00';
      ctx.fillRect(-halfW - 3, -halfH, 6, this.height);
      ctx.fillRect(halfW - 3, -halfH, 6, this.height);
    } else {
      // Standard cyber-barrier
      ctx.translate(this.x - halfW, this.y - halfH);

      // Pass 1: Outer glow
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.4;
      ctx.strokeRect(0, 0, this.width, this.height);

      // Pass 2: Solid core with warning stripes
      ctx.fillStyle = '#140508';
      ctx.globalAlpha = 0.95;
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.fillStyle = this.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(2, 2, this.width - 4, this.height - 4);

      // White warning chevron in center
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(halfW - 6, halfH - 4);
      ctx.lineTo(halfW + 4, halfH);
      ctx.lineTo(halfW - 6, halfH + 4);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }
}

export class ObstacleManager {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.leftRailX=80]
   * @param {number} [options.rightRailX=320]
   * @param {number} [options.baseSpeed=360]
   */
  constructor(options = {}) {
    this.leftRailX = options.leftRailX ?? 80;
    this.rightRailX = options.rightRailX ?? 320;
    this.baseSpeed = options.baseSpeed ?? 360;

    this.obstacles = [];
    this.elapsedTime = 0;
    this.distanceTraveled = 0;
    this.nextSpawnDistance = 140; // Initial distance to first obstacle

    // Escalation speed curve: v(t) = v0 + 60 * ln(1 + t/12)
    this.currentSpeed = this.baseSpeed;
    this.maxSpeed = 740;

    // Pattern tracking to ensure solvable tracks
    this.lastSpawnedRail = null;
  }

  /**
   * Resets all obstacles and progression.
   */
  reset() {
    this.obstacles = [];
    this.elapsedTime = 0;
    this.distanceTraveled = 0;
    this.nextSpawnDistance = 140;
    this.currentSpeed = this.baseSpeed;
    this.lastSpawnedRail = null;
  }

  /**
   * Fixed physics tick update.
   * @param {number} dt - Fixed delta time
   * @param {number} [virtualHeight=900]
   */
  update(dt, virtualHeight = 900) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    this.elapsedTime += dt;

    // Update dynamic logarithmic escalation curve
    this.currentSpeed = Math.min(
      this.maxSpeed,
      this.baseSpeed + 65 * Math.log(1 + this.elapsedTime / 12)
    );

    const stepDist = this.currentSpeed * dt;
    this.distanceTraveled += stepDist;

    // Check obstacle spawning
    if (this.distanceTraveled >= this.nextSpawnDistance) {
      this.spawnProceduralObstacle();
      // Next obstacle distance scales moderately with speed to preserve reaction window
      const baseGap = 260 + Math.random() * 80;
      this.nextSpawnDistance = this.distanceTraveled + baseGap;
    }

    // Update active obstacles and remove off-screen ones
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.update(dt, this.currentSpeed);

      // Cull when far below screen
      if (obs.y > virtualHeight + 80) {
        this.obstacles.splice(i, 1);
      }
    }
  }

  /**
   * Spawns a solvable, procedural obstacle on one rail or oscillating in center.
   */
  spawnProceduralObstacle() {
    // Choose which rail or type to target
    // Alternate rails to guarantee solvable passages
    let targetRail = Math.random() > 0.5 ? 'left' : 'right';
    if (this.lastSpawnedRail && Math.random() < 0.75) {
      // 75% bias towards opposite rail to create rhythmic gravity flip challenge
      targetRail = this.lastSpawnedRail === 'left' ? 'right' : 'left';
    }
    this.lastSpawnedRail = targetRail;

    const railX = targetRail === 'left' ? this.leftRailX : this.rightRailX;
    const rand = Math.random();

    let obs;
    if (rand < 0.45) {
      // Standard cyber barrier on target rail
      obs = new Obstacle({
        type: HAZARD_BARRIER,
        x: railX,
        y: -40,
        width: 68,
        height: 24,
        color: '#FF3344',
        grazeMargin: GRAZE_MARGIN_DEFAULT
      });
    } else if (rand < 0.75) {
      // Rotating pulse node on target rail
      obs = new Obstacle({
        type: HAZARD_PULSE_NODE,
        x: railX,
        y: -40,
        width: 28,
        height: 28,
        color: '#FFAA00',
        grazeMargin: GRAZE_MARGIN_DEFAULT
      });
    } else {
      // Moving laser gate oscillating between rails
      obs = new Obstacle({
        type: HAZARD_LASER_GATE,
        x: 200, // Center
        y: -40,
        width: 76,
        height: 18,
        color: '#FF0055',
        oscAmplitude: 100,
        oscSpeed: 2.5 + Math.random() * 1.5,
        grazeMargin: GRAZE_MARGIN_DEFAULT
      });
    }

    this.obstacles.push(obs);
    return obs;
  }

  /**
   * Evaluates collision with player hitbox.
   * Detects lethal crash vs near-miss graze (+20px margin).
   * @param {Object} player - Player entity with getHitbox()
   * @returns {{ lethal: boolean, lethalObstacle: Obstacle|null, nearMisses: Obstacle[] }}
   */
  checkCollisions(player) {
    const playerHitbox = player.getHitbox();
    const result = {
      lethal: false,
      lethalObstacle: null,
      nearMisses: []
    };

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];

      // 1. Check lethal collision first
      const lethalBox = obs.getLethalHitbox();
      if (checkAABB(playerHitbox, lethalBox)) {
        result.lethal = true;
        result.lethalObstacle = obs;
        return result; // Immediate game over on lethal contact
      }

      // 2. Check near-miss graze margin (+20px)
      if (!obs.grazed) {
        const grazeBox = obs.getGrazeHitbox();
        if (checkAABB(playerHitbox, grazeBox)) {
          obs.grazed = true;
          result.nearMisses.push(obs);
        }
      }
    }

    return result;
  }

  /**
   * Renders all active obstacles.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    for (let i = 0; i < this.obstacles.length; i++) {
      this.obstacles[i].render(ctx);
    }
  }
}
