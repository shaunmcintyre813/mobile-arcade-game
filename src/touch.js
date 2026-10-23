/* ==========================================================================
   TouchController - AntiGravity: Neon Pulse
   Zero-Latency Non-Passive Mobile Touch & Gesture Controller
   Suppresses Pull-to-Refresh & Pinch-to-Zoom; Maps to Virtual Coordinates
   ========================================================================== */

export class TouchController {
  /**
   * @param {HTMLElement} targetElement - The element to attach touch listeners to (canvas)
   * @param {Object} [displayManager=null] - Optional DisplayManager instance for coordinate projection
   * @param {Object} [callbacks={}] - Callback handlers: onTap, onDrag, onRelease
   */
  constructor(targetElement, displayManager = null, callbacks = {}) {
    if (!targetElement) {
      throw new Error('[TouchController] Target element is required.');
    }

    this.target = targetElement;
    this.display = displayManager;
    this.disambiguateTapDrag = Boolean(callbacks.disambiguateTapDrag);
    this.tapThreshold = Number.isFinite(callbacks.tapThreshold) ? callbacks.tapThreshold : 10;
    this.tapMaxDuration = Number.isFinite(callbacks.tapMaxDuration) ? callbacks.tapMaxDuration : 350;

    this.callbacks = {
      onTap: typeof callbacks.onTap === 'function' ? callbacks.onTap : null,
      onDrag: typeof callbacks.onDrag === 'function' ? callbacks.onDrag : null,
      onRelease: typeof callbacks.onRelease === 'function' ? callbacks.onRelease : null,
      ...callbacks
    };

    // Tracking state
    this.touchActive = false;
    this.touchId = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.currentVirtualX = 200;
    this.currentVirtualY = 400;
    this.dragDeltaX = 0;
    this.dragDeltaY = 0;
    this.tapTriggered = false;
    this.hasMoved = false;
    this.isDragging = false;

    // Listener references for removal
    this._listeners = [];

    this.bindEvents();
  }

  /**
   * Static factory method conforming to PROJECT.md interface contract.
   * Supports `TouchController.init(targetElement, callbacks)`
   * or `TouchController.init(targetElement, displayManager, callbacks)`.
   * @param {HTMLElement} targetElement
   * @param {Object|Function} [displayOrCallbacks]
   * @param {Object} [callbacks]
   * @returns {TouchController}
   */
  static init(targetElement, displayOrCallbacks = {}, maybeCallbacks = {}) {
    let display = null;
    let cb = {};

    if (displayOrCallbacks && typeof displayOrCallbacks.screenToVirtual === 'function') {
      display = displayOrCallbacks;
      cb = maybeCallbacks || {};
    } else if (typeof displayOrCallbacks === 'object') {
      cb = displayOrCallbacks;
      display = cb.displayManager || null;
    }

    return new TouchController(targetElement, display, cb);
  }

  /**
   * Converts clientX / clientY to virtual game coordinates.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  toVirtualCoords(clientX, clientY) {
    let screenX = clientX;
    let screenY = clientY;

    if (this.target && typeof this.target.getBoundingClientRect === 'function') {
      const rect = this.target.getBoundingClientRect();
      screenX = clientX - rect.left;
      screenY = clientY - rect.top;
    }

    if (this.display && typeof this.display.screenToVirtual === 'function') {
      return this.display.screenToVirtual(screenX, screenY);
    }

    // Fallback: estimate scale from element width vs 400 reference
    const scale = (this.target && this.target.clientWidth) ? (this.target.clientWidth / 400) : 1;
    return {
      x: screenX / (scale > 0 ? scale : 1),
      y: screenY / (scale > 0 ? scale : 1)
    };
  }

  /**
   * Registers non-passive touch listeners on the target element.
   */
  bindEvents() {
    // Explicit non-passive options to permit preventDefault()
    const nonPassiveOpts = { passive: false };

    const add = (type, fn) => {
      this.target.addEventListener(type, fn, nonPassiveOpts);
      this._listeners.push({ type, fn });
    };

    add('touchstart', (e) => this.handleTouchStart(e));
    add('touchmove', (e) => this.handleTouchMove(e));
    add('touchend', (e) => this.handleTouchEnd(e));
    add('touchcancel', (e) => this.handleTouchCancel(e));

    // Pointer fallback for desktop testing & mouse clicks
    add('pointerdown', (e) => {
      if (e.pointerType === 'mouse') this.handlePointerDown(e);
    });
    add('pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.touchActive && this.touchId === 'mouse') {
        this.handlePointerMove(e);
      }
    });
    add('pointerup', (e) => {
      if (e.pointerType === 'mouse' && this.touchId === 'mouse') {
        this.handlePointerUp(e);
      }
    });
  }

  handleTouchStart(e) {
    // CRITICAL: e.preventDefault() annihilates browser pull-to-refresh & pinch-to-zoom
    if (e.cancelable && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (this.touchActive) return; // Primary single-touch lock

    const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : (e.touches && e.touches[0]);
    if (!touch) return;

    this.touchId = touch.identifier;
    this.touchActive = true;
    this.hasMoved = false;
    this.isDragging = false;
    this.touchStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const coords = this.toVirtualCoords(touch.clientX, touch.clientY);
    this.touchStartX = coords.x;
    this.touchStartY = coords.y;
    this.currentVirtualX = coords.x;
    this.currentVirtualY = coords.y;
    this.dragDeltaX = 0;
    this.dragDeltaY = 0;

    if (!this.disambiguateTapDrag) {
      // Legacy behavior: Immediately notify onTap for zero-latency gravity inversion on touch contact
      this.tapTriggered = true;
      if (this.callbacks.onTap) {
        this.callbacks.onTap(coords);
      }
    } else {
      this.tapTriggered = false;
    }
  }

  handleTouchMove(e) {
    if (e.cancelable && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (!this.touchActive || !e.changedTouches) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.touchId) {
        const coords = this.toVirtualCoords(touch.clientX, touch.clientY);
        const deltaX = coords.x - this.currentVirtualX;
        const deltaY = coords.y - this.currentVirtualY;

        this.dragDeltaX = deltaX;
        this.dragDeltaY = deltaY;
        this.currentVirtualX = coords.x;
        this.currentVirtualY = coords.y;
        this.hasMoved = true;

        if (this.disambiguateTapDrag) {
          const totalDist = Math.hypot(coords.x - this.touchStartX, coords.y - this.touchStartY);
          if (totalDist > this.tapThreshold) {
            this.isDragging = true;
          }
        } else {
          this.isDragging = true;
        }

        if (this.callbacks.onDrag) {
          this.callbacks.onDrag(coords, { x: deltaX, y: deltaY });
        }
        break;
      }
    }
  }

  handleTouchEnd(e) {
    if (e.cancelable && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (!e.changedTouches) {
      this.clearTouch();
      return;
    }

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.touchId) {
        if (this.disambiguateTapDrag) {
          const coords = this.toVirtualCoords(touch.clientX, touch.clientY);
          const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.touchStartTime;
          const totalDist = Math.hypot(coords.x - this.touchStartX, coords.y - this.touchStartY);

          // If touch was quick and did not move beyond tap threshold, it is a deliberate TAP!
          if (!this.isDragging && totalDist <= this.tapThreshold && duration <= this.tapMaxDuration) {
            this.tapTriggered = true;
            if (this.callbacks.onTap) {
              this.callbacks.onTap(coords);
            }
          }
        }
        this.clearTouch();
        break;
      }
    }
  }

  handleTouchCancel(e) {
    if (e.cancelable && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    this.clearTouch();
  }

  handlePointerDown(e) {
    if (this.touchActive) return;
    this.touchId = 'mouse';
    this.touchActive = true;
    this.hasMoved = false;
    this.isDragging = false;
    this.touchStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const coords = this.toVirtualCoords(e.clientX, e.clientY);
    this.touchStartX = coords.x;
    this.touchStartY = coords.y;
    this.currentVirtualX = coords.x;
    this.currentVirtualY = coords.y;
    this.dragDeltaX = 0;
    this.dragDeltaY = 0;

    if (!this.disambiguateTapDrag) {
      this.tapTriggered = true;
      if (this.callbacks.onTap) {
        this.callbacks.onTap(coords);
      }
    } else {
      this.tapTriggered = false;
    }
  }

  handlePointerMove(e) {
    const coords = this.toVirtualCoords(e.clientX, e.clientY);
    const deltaX = coords.x - this.currentVirtualX;
    const deltaY = coords.y - this.currentVirtualY;

    this.dragDeltaX = deltaX;
    this.dragDeltaY = deltaY;
    this.currentVirtualX = coords.x;
    this.currentVirtualY = coords.y;
    this.hasMoved = true;

    if (this.disambiguateTapDrag) {
      const totalDist = Math.hypot(coords.x - this.touchStartX, coords.y - this.touchStartY);
      if (totalDist > this.tapThreshold) {
        this.isDragging = true;
      }
    } else {
      this.isDragging = true;
    }

    if (this.callbacks.onDrag) {
      this.callbacks.onDrag(coords, { x: deltaX, y: deltaY });
    }
  }

  handlePointerUp(e) {
    if (this.disambiguateTapDrag) {
      const coords = this.toVirtualCoords(e.clientX, e.clientY);
      const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.touchStartTime;
      const totalDist = Math.hypot(coords.x - this.touchStartX, coords.y - this.touchStartY);

      if (!this.isDragging && totalDist <= this.tapThreshold && duration <= this.tapMaxDuration) {
        this.tapTriggered = true;
        if (this.callbacks.onTap) {
          this.callbacks.onTap(coords);
        }
      }
    }
    this.clearTouch();
  }

  clearTouch() {
    this.touchActive = false;
    this.touchId = null;
    this.isDragging = false;
    this.dragDeltaX = 0;
    this.dragDeltaY = 0;

    if (this.callbacks.onRelease) {
      this.callbacks.onRelease();
    }
  }

  /**
   * Consumes and clears buffered input for synchronous frame ticks.
   * @returns {{ flipGravity: boolean, dragX: number, dragY: number, virtualX: number, virtualY: number, active: boolean }}
   */
  consumeInput() {
    const input = {
      flipGravity: this.tapTriggered,
      dragX: this.dragDeltaX,
      dragY: this.dragDeltaY,
      virtualX: this.currentVirtualX,
      virtualY: this.currentVirtualY,
      active: this.touchActive
    };
    this.tapTriggered = false;
    this.dragDeltaX = 0;
    this.dragDeltaY = 0;
    return input;
  }

  /**
   * Destroys event listeners on teardown.
   */
  destroy() {
    for (const { type, fn } of this._listeners) {
      this.target.removeEventListener(type, fn);
    }
    this._listeners = [];
  }
}
