/* ==========================================================================
   RailSystem - AntiGravity: Neon Pulse
   Twin Cyber-Rails, Dynamic Perspective Grids & High-Speed Warp Lines
   ========================================================================== */

export const DEFAULT_LEFT_RAIL_X = 80;
export const DEFAULT_RIGHT_RAIL_X = 320;

export class RailSystem {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.leftX=80]
   * @param {number} [options.rightX=320]
   * @param {number} [options.speedLineCount=40]
   * @param {number} [options.gridSpacing=60]
   */
  constructor(options = {}) {
    this.leftX = options.leftX ?? DEFAULT_LEFT_RAIL_X;
    this.rightX = options.rightX ?? DEFAULT_RIGHT_RAIL_X;
    this.speedLineCount = options.speedLineCount ?? 40;
    this.gridSpacing = options.gridSpacing ?? 60;

    this.gridOffset = 0;
    this.pulsePhase = 0;

    // Rail theme colors
    this.leftColor = '#00F0FF'; // Cyan (Alpha Rail)
    this.rightColor = '#FF0055'; // Magenta (Beta Rail)
    this.gridColor = 'rgba(25, 45, 80, 0.35)';

    // Pre-allocated speed lines (zero-allocation pool)
    this.speedLines = new Array(this.speedLineCount);
    for (let i = 0; i < this.speedLineCount; i++) {
      this.speedLines[i] = {
        x: Math.random() * 400,
        y: Math.random() * 1000,
        speedMult: 0.6 + Math.random() * 0.8,
        width: 1 + Math.random() * 1.5,
        alpha: 0.15 + Math.random() * 0.35,
        color: Math.random() > 0.5 ? '#00F0FF' : '#FF0055'
      };
    }
  }

  /**
   * Updates scrolling offsets and speed lines.
   * @param {number} dt - Fixed delta time
   * @param {number} [currentSpeed=360] - Current world scroll speed (px/s)
   * @param {number} [virtualHeight=900] - Current virtual height
   */
  update(dt, currentSpeed = 360, virtualHeight = 900) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    // Update grid scroll offset
    this.gridOffset = (this.gridOffset + currentSpeed * dt) % this.gridSpacing;
    this.pulsePhase = (this.pulsePhase + dt * 4) % (Math.PI * 2);

    // Update speed lines
    for (let i = 0; i < this.speedLineCount; i++) {
      const line = this.speedLines[i];
      line.y += currentSpeed * line.speedMult * dt;
      if (line.y > virtualHeight + 50) {
        line.y = -50 - Math.random() * 100;
        line.x = Math.random() * 400;
      }
    }
  }

  /**
   * Renders cyber-grid, twin rails with multi-pass neon glow, and speed lines.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [virtualWidth=400]
   * @param {number} [virtualHeight=900]
   * @param {number} [currentSpeed=360]
   */
  render(ctx, virtualWidth = 400, virtualHeight = 900, currentSpeed = 360) {
    ctx.save();

    // 1. Draw dynamic background perspective grid
    this._renderGrid(ctx, virtualWidth, virtualHeight);

    // 2. Draw high-speed warp lines
    this._renderSpeedLines(ctx, currentSpeed);

    // 3. Draw twin cyber-rails
    this._renderRail(ctx, this.leftX, virtualHeight, this.leftColor, this.pulsePhase);
    this._renderRail(ctx, this.rightX, virtualHeight, this.rightColor, this.pulsePhase + Math.PI);

    ctx.restore();
  }

  /**
   * Renders background horizontal scrolling grid lines.
   * @private
   */
  _renderGrid(ctx, virtualWidth, virtualHeight) {
    ctx.save();
    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;

    // Horizontal scrolling lines
    const startY = this.gridOffset - this.gridSpacing;
    for (let y = startY; y <= virtualHeight + this.gridSpacing; y += this.gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(virtualWidth, y);
      ctx.stroke();
    }

    // Outer boundary vertical guidelines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(20, virtualHeight);
    ctx.moveTo(virtualWidth - 20, 0);
    ctx.lineTo(virtualWidth - 20, virtualHeight);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renders downward streaming speed lines.
   * @private
   */
  _renderSpeedLines(ctx, currentSpeed) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const streakLength = Math.max(12, Math.min(60, 10 + currentSpeed / 20));

    for (let i = 0; i < this.speedLineCount; i++) {
      const line = this.speedLines[i];
      ctx.strokeStyle = line.color;
      ctx.globalAlpha = line.alpha;
      ctx.lineWidth = line.width;

      ctx.beginPath();
      ctx.moveTo(line.x, line.y);
      ctx.lineTo(line.x, line.y + streakLength * line.speedMult);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Renders an individual cyber-rail with 3-pass hardware neon glow and pulse nodes.
   * @private
   */
  _renderRail(ctx, x, virtualHeight, color, pulse) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';

    // Pass 1: Wide diffuse glow
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, virtualHeight);
    ctx.stroke();

    // Pass 2: Medium vibrant aura
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, virtualHeight);
    ctx.stroke();

    // Pass 3: Ultra-sharp white/cyan core
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, virtualHeight);
    ctx.stroke();

    // Energy pulse nodes traveling down the rail
    const pulseOffset = (pulse * 60) % 180;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    for (let py = pulseOffset; py < virtualHeight; py += 180) {
      ctx.beginPath();
      ctx.arc(x, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
