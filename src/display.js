/* ==========================================================================
   DisplayManager - AntiGravity: Neon Pulse
   Fixed-Width Dynamic-Height Coordinate Projection & High-DPI Canvas Scaler
   Optimized for Samsung Galaxy S25 Ultra (412x915 CSS px, DPR <= 3.0)
   ========================================================================== */

export class DisplayManager {
  /**
   * Initializes the DisplayManager on a canvas element.
   * @param {HTMLCanvasElement} canvas - Target canvas element
   * @param {number} [virtualWidth=400] - Fixed virtual width reference
   */
  constructor(canvas, virtualWidth = 400) {
    if (!canvas) {
      throw new Error('[DisplayManager] Target canvas element is required.');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext ? canvas.getContext('2d', { alpha: false }) : null;
    this.virtualWidth = virtualWidth;
    this.virtualHeight = 888;
    this.scale = 1;
    this.dpr = 1;
    this.screenWidth = 412;
    this.screenHeight = 915;
    this.resizeCallbacks = new Set();

    // Bound listeners for clean lifecycle cleanup
    this._handleResize = () => this.resize();
    this._handleOrientation = () => setTimeout(() => this.resize(), 100);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._handleResize);
      window.addEventListener('orientationchange', this._handleOrientation);
    }

    this.resize();
  }

  /**
   * Static factory method conforming to PROJECT.md interface contract.
   * @param {HTMLCanvasElement} canvasElement
   * @param {number} [virtualWidth=400]
   * @returns {DisplayManager}
   */
  static init(canvasElement, virtualWidth = 400) {
    return new DisplayManager(canvasElement, virtualWidth);
  }

  /**
   * Recalculates canvas dimensions, scale factor, and virtual viewport.
   * Clamps DPR to 3.0 to protect GPU memory on QHD+ displays.
   */
  resize() {
    const width = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 412;
    const height = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 915;
    const rawDpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;

    this.screenWidth = width;
    this.screenHeight = height;

    // Clamp device pixel ratio up to 3.0 to prevent memory exhaustion on ultra-dense displays
    this.dpr = Math.min(Math.max(rawDpr, 1), 3.0);

    // Compute virtual space projection:
    // Scale factor S = width / virtualWidth (e.g. 412 / 400 = 1.03)
    this.scale = width / this.virtualWidth;

    // Virtual height Hv = height / S = height * (virtualWidth / width) (e.g. 915 / 1.03 ≈ 888.35)
    this.virtualHeight = height / this.scale;

    // Set physical backbuffer resolution
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);

    // Set CSS presentation size
    if (this.canvas.style) {
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }

    // Set 2D context transform matrix so rendering draws directly in virtual units
    if (this.ctx && typeof this.ctx.setTransform === 'function') {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      const totalScale = this.scale * this.dpr;
      this.ctx.scale(totalScale, totalScale);
    }

    const bounds = this.getVirtualBounds();
    for (const callback of this.resizeCallbacks) {
      callback(bounds);
    }

    return bounds;
  }

  /**
   * Converts CSS touch/pointer screen coordinates relative to canvas into virtual units.
   * @param {number} screenX - X coordinate relative to canvas bounding box
   * @param {number} screenY - Y coordinate relative to canvas bounding box
   * @returns {{ x: number, y: number }}
   */
  screenToVirtual(screenX, screenY) {
    const effectiveScale = this.scale > 0 ? this.scale : 1;
    return {
      x: screenX / effectiveScale,
      y: screenY / effectiveScale
    };
  }

  /**
   * Returns the current virtual viewport geometry.
   * @returns {{ width: number, height: number, scale: number, dpr: number, screenWidth: number, screenHeight: number }}
   */
  getVirtualBounds() {
    return {
      width: this.virtualWidth,
      height: this.virtualHeight,
      scale: this.scale,
      dpr: this.dpr,
      screenWidth: this.screenWidth,
      screenHeight: this.screenHeight
    };
  }

  /**
   * Registers a listener to be notified whenever viewport resizes.
   * @param {Function} callback
   */
  onResize(callback) {
    if (typeof callback === 'function') {
      this.resizeCallbacks.add(callback);
    }
  }

  /**
   * Unregisters a resize listener.
   * @param {Function} callback
   */
  offResize(callback) {
    this.resizeCallbacks.delete(callback);
  }

  /**
   * Clean up event listeners.
   */
  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._handleResize);
      window.removeEventListener('orientationchange', this._handleOrientation);
    }
    this.resizeCallbacks.clear();
  }
}
