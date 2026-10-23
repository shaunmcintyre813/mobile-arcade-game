/* ==========================================================================
   Player - AntiGravity: Neon Pulse
   Dual-Rail Gravity Runner Entity
   Snappy Gravity Inversion Physics & Thumb Micro-Drag Lateral Steering
   ========================================================================== */

export const RAIL_LEFT = 'left';
export const RAIL_RIGHT = 'right';

export const RAIL_X_LEFT = 80;
export const RAIL_X_RIGHT = 320;

export class Player {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.leftRailX=80]
   * @param {number} [options.rightRailX=320]
   * @param {number} [options.y=650]
   * @param {number} [options.width=22]
   * @param {number} [options.height=26]
   * @param {number} [options.maxDragOffset=35]
   */
  constructor(options = {}) {
    this.leftRailX = options.leftRailX ?? RAIL_X_LEFT;
    this.rightRailX = options.rightRailX ?? RAIL_X_RIGHT;
    this.initialY = options.y ?? 650;
    this.width = options.width ?? 22;
    this.height = options.height ?? 26;
    this.maxDragOffset = options.maxDragOffset ?? 35;

    // Movement & state
    this.currentRail = RAIL_LEFT;
    this.targetRail = RAIL_LEFT;
    this.x = this.leftRailX;
    this.y = this.initialY;
    this.targetX = this.leftRailX;
    this.dragOffset = 0;
    this.vx = 0;
    this.isFlipping = false;
    this.flipSpeed = 26; // High responsiveness spring factor
    this.tilt = 0; // In radians for banking effect

    // Polarity theme
    this.primaryColor = '#00F0FF'; // Cyan (Alpha polarity - left)
    this.secondaryColor = '#FF0055'; // Magenta (Beta polarity - right)
    this.currentColor = this.primaryColor;

    // Pre-allocated trail history buffer (12 slots)
    this.trailLength = 12;
    this.trail = [];
    for (let i = 0; i < this.trailLength; i++) {
      this.trail.push({ x: this.x, y: this.y, tilt: 0, color: this.primaryColor, active: false });
    }
    this.trailTimer = 0;
    this.trailInterval = 0.016; // ~60Hz trail snapshot rate
  }

  /**
   * Inverts gravity polarity and switches the target rail.
   * Smoothly resets micro-drag offset to ensure clean trajectory.
   * @returns {string} New target rail ('left' or 'right')
   */
  flipGravity() {
    if (this.targetRail === RAIL_LEFT) {
      this.targetRail = RAIL_RIGHT;
      this.currentColor = this.secondaryColor;
    } else {
      this.targetRail = RAIL_LEFT;
      this.currentColor = this.primaryColor;
    }

    this.isFlipping = true;
    this.dragOffset = 0;
    return this.targetRail;
  }

  /**
   * Applies thumb micro-drag lateral delta, clamped to safe rail bounds.
   * @param {number} deltaX - Virtual coordinate delta
   */
  applyMicroDrag(deltaX) {
    if (!Number.isFinite(deltaX)) return;
    this.dragOffset = Math.max(-this.maxDragOffset, Math.min(this.maxDragOffset, this.dragOffset + deltaX));
  }

  /**
   * Directly sets the lateral micro-drag offset within safe bounds.
   * @param {number} offset
   */
  setMicroDrag(offset) {
    if (!Number.isFinite(offset)) return;
    this.dragOffset = Math.max(-this.maxDragOffset, Math.min(this.maxDragOffset, offset));
  }

  /**
   * Fixed physics tick update.
   * @param {number} dt - Fixed delta time (typically 1/120s)
   */
  update(dt) {
    const baseRailX = this.targetRail === RAIL_LEFT ? this.leftRailX : this.rightRailX;
    this.targetX = baseRailX + this.dragOffset;

    // Snappy critically-damped spring approach towards targetX
    const dx = this.targetX - this.x;
    const speed = this.isFlipping ? this.flipSpeed : 34;
    const step = dx * Math.min(1, speed * dt);
    this.x += step;
    this.vx = step / (dt > 0 ? dt : 0.008);

    // Check if player has essentially reached the destination target position
    if (Math.abs(this.x - this.targetX) < 1.5) {
      this.currentRail = this.targetRail;
      this.isFlipping = false;
      this.x = this.targetX;
    }

    // Dynamic banking tilt (max ~0.35 rad)
    const targetTilt = Math.max(-0.35, Math.min(0.35, dx * 0.008));
    this.tilt += (targetTilt - this.tilt) * Math.min(1, 20 * dt);

    // Trail buffer update
    this.trailTimer += dt;
    if (this.trailTimer >= this.trailInterval) {
      this.trailTimer = 0;
      // Shift trail buffer
      for (let i = this.trailLength - 1; i > 0; i--) {
        this.trail[i].x = this.trail[i - 1].x;
        this.trail[i].y = this.trail[i - 1].y;
        this.trail[i].tilt = this.trail[i - 1].tilt;
        this.trail[i].color = this.trail[i - 1].color;
        this.trail[i].active = this.trail[i - 1].active;
      }
      this.trail[0].x = this.x;
      this.trail[0].y = this.y;
      this.trail[0].tilt = this.tilt;
      this.trail[0].color = this.currentColor;
      this.trail[0].active = true;
    }
  }

  /**
   * Bounding geometry and collision hitbox.
   * @returns {{ x: number, y: number, width: number, height: number, left: number, right: number, top: number, bottom: number }}
   */
  getHitbox() {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    return {
      x: this.x - halfW,
      y: this.y - halfH,
      width: this.width,
      height: this.height,
      left: this.x - halfW,
      right: this.x + halfW,
      top: this.y - halfH,
      bottom: this.y + halfH
    };
  }

  /**
   * Resets player state to initial coordinates and polarity.
   * @param {number} [y] - Optional y coordinate
   */
  reset(y) {
    if (Number.isFinite(y)) {
      this.initialY = y;
    }
    this.currentRail = RAIL_LEFT;
    this.targetRail = RAIL_LEFT;
    this.x = this.leftRailX;
    this.y = this.initialY;
    this.targetX = this.leftRailX;
    this.dragOffset = 0;
    this.vx = 0;
    this.isFlipping = false;
    this.tilt = 0;
    this.currentColor = this.primaryColor;
    for (let i = 0; i < this.trailLength; i++) {
      this.trail[i].x = this.x;
      this.trail[i].y = this.y;
      this.trail[i].tilt = 0;
      this.trail[i].color = this.primaryColor;
      this.trail[i].active = false;
    }
  }

  /**
   * Dynamically adjusts player vertical anchor coordinate (e.g. on viewport resize).
   * @param {number} y
   */
  setAnchorY(y) {
    if (Number.isFinite(y)) {
      this.initialY = y;
      this.y = y;
      for (let i = 0; i < this.trailLength; i++) {
        this.trail[i].y = y;
      }
    }
  }

  /**
   * Multi-pass neon render of player ship and trailing wake.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    ctx.save();

    // 1. Render wake trail (additive blend)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.trailLength; i++) {
      const p = this.trail[i];
      if (!p.active) continue;
      const alpha = (1 - (i / this.trailLength)) * 0.35;
      const radius = (this.width * 0.4) * (1 - (i / this.trailLength) * 0.6);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y + (i * 2.5), radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Render player energy ship
    ctx.translate(this.x, this.y);
    ctx.rotate(this.tilt);

    const w = this.width;
    const h = this.height;

    // Pass 1: Diffuse outer glow
    ctx.strokeStyle = this.currentColor;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.25;
    this._drawShipPath(ctx, w, h);
    ctx.stroke();

    // Pass 2: Medium vibrant aura
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.65;
    this._drawShipPath(ctx, w, h);
    ctx.stroke();

    // Pass 3: Ultra-sharp white/cyan core
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = 0.95;
    this._drawShipPath(ctx, w * 0.7, h * 0.7);
    ctx.fill();

    // Pass 4: Center plasma crystal
    ctx.fillStyle = this.currentColor;
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Internal helper to draw sleek arrowhead delta-wing ship path.
   * @private
   */
  _drawShipPath(ctx, w, h) {
    const halfW = w / 2;
    const halfH = h / 2;
    ctx.beginPath();
    // Tip pointing forward (upwards)
    ctx.moveTo(0, -halfH);
    // Right wing
    ctx.lineTo(halfW, halfH * 0.7);
    // Center indented thruster
    ctx.lineTo(0, halfH * 0.3);
    // Left wing
    ctx.lineTo(-halfW, halfH * 0.7);
    ctx.closePath();
  }
}
