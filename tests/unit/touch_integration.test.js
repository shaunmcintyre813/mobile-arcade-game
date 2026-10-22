import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEngine, STATE_START, STATE_PLAYING } from '../../src/game.js';
import { Player, RAIL_LEFT, RAIL_RIGHT } from '../../src/player.js';

function createInteractiveCanvas() {
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

describe('Touch Integration & Gravity Flip Guarantees', () => {
  let canvas;
  let game;

  beforeEach(() => {
    canvas = createInteractiveCanvas();
    game = new GameEngine(canvas);
  });

  it('Requirement 3a: Dispatching simulated touchstart / touchend through TouchController results in exactly ONE gravity flip', () => {
    game.startPlaying();

    expect(game.player.currentRail).toBe(RAIL_LEFT);
    expect(game.player.targetRail).toBe(RAIL_LEFT);
    expect(game.player.isFlipping).toBe(false);

    // 1. Dispatch touchstart on canvas
    canvas.dispatchCanvasEvent('touchstart', {
      changedTouches: [{ identifier: 1, clientX: 200, clientY: 450 }]
    });

    // Zero-latency reactive flip: targetRail switches to RAIL_RIGHT immediately
    expect(game.player.targetRail).toBe(RAIL_RIGHT);
    expect(game.player.isFlipping).toBe(true);

    // 2. Dispatch touchend on canvas
    canvas.dispatchCanvasEvent('touchend', {
      changedTouches: [{ identifier: 1, clientX: 200, clientY: 450 }]
    });

    // 3. Execute fixed physics update tick (1/120s = 8.3ms later)
    game.update(1 / 120);

    // CRITICAL: Player must NOT bounce back to RAIL_LEFT
    expect(game.player.targetRail).toBe(RAIL_RIGHT);

    // 4. Step physics loop until flip transition completes (60 frames = 0.5s)
    for (let i = 0; i < 60; i++) {
      game.update(1 / 120);
    }

    expect(game.player.targetRail).toBe(RAIL_RIGHT);
    expect(game.player.currentRail).toBe(RAIL_RIGHT);
    expect(game.player.isFlipping).toBe(false);
    expect(game.player.x).toBe(game.player.rightRailX);

    // 5. Subsequent touchstart flips cleanly back to RAIL_LEFT exactly once
    canvas.dispatchCanvasEvent('touchstart', {
      changedTouches: [{ identifier: 2, clientX: 200, clientY: 450 }]
    });

    expect(game.player.targetRail).toBe(RAIL_LEFT);
    expect(game.player.isFlipping).toBe(true);

    game.update(1 / 120);
    expect(game.player.targetRail).toBe(RAIL_LEFT);

    for (let i = 0; i < 60; i++) {
      game.update(1 / 120);
    }

    expect(game.player.targetRail).toBe(RAIL_LEFT);
    expect(game.player.currentRail).toBe(RAIL_LEFT);
    expect(game.player.isFlipping).toBe(false);
    expect(game.player.x).toBe(game.player.leftRailX);
  });

  it('Consecutive frame updates after touchstart never trigger ghost flips', () => {
    game.startPlaying();

    canvas.dispatchCanvasEvent('touchstart', {
      changedTouches: [{ identifier: 10, clientX: 200, clientY: 450 }]
    });

    expect(game.player.targetRail).toBe(RAIL_RIGHT);

    // Over 20 consecutive frame updates, the targetRail must stay firmly locked to RAIL_RIGHT
    for (let frame = 1; frame <= 20; frame++) {
      game.update(1 / 120);
      expect(game.player.targetRail).toBe(RAIL_RIGHT);
    }
  });

  it('Start screen tap transitions to PLAYING state without unintended gravity flip on next frame', () => {
    expect(game.state).toBe(STATE_START);
    expect(game.player.targetRail).toBe(RAIL_LEFT);
    expect(game.player.currentRail).toBe(RAIL_LEFT);

    // Tap to start game
    canvas.dispatchCanvasEvent('touchstart', {
      changedTouches: [{ identifier: 1, clientX: 200, clientY: 450 }]
    });

    expect(game.state).toBe(STATE_PLAYING);
    // Player should remain on left rail at game start
    expect(game.player.targetRail).toBe(RAIL_LEFT);

    // Next frame update must NOT interpret start tap as a gravity flip
    game.update(1 / 120);
    expect(game.state).toBe(STATE_PLAYING);
    expect(game.player.targetRail).toBe(RAIL_LEFT);
    expect(game.player.currentRail).toBe(RAIL_LEFT);
    expect(game.player.isFlipping).toBe(false);
  });

  it('Touch drag event integration does not double-apply sensitivity', () => {
    game.startPlaying();

    canvas.dispatchCanvasEvent('touchstart', {
      changedTouches: [{ identifier: 100, clientX: 200, clientY: 450 }]
    });

    // Touch move by +15px
    canvas.dispatchCanvasEvent('touchmove', {
      changedTouches: [{ identifier: 100, clientX: 215, clientY: 450 }]
    });

    // Drag offset applied reactively (converted from screen CSS px to virtual game units)
    const initialDragOffset = game.player.dragOffset;
    expect(initialDragOffset).toBeCloseTo(14.56, 1);

    // Update frame: should NOT double to ~29.12
    game.update(1 / 120);
    expect(game.player.dragOffset).toBe(initialDragOffset);
  });
});

describe('Flip Completion Under Micro-Drag Convergence', () => {
  it('Requirement 3b: Flipping gravity while actively applying +25px micro-drag converges to targetX and cleanly resets isFlipping', () => {
    const player = new Player({ leftRailX: 80, rightRailX: 320, maxDragOffset: 35 });

    expect(player.currentRail).toBe(RAIL_LEFT);
    expect(player.targetRail).toBe(RAIL_LEFT);
    expect(player.isFlipping).toBe(false);

    // Initiate gravity flip
    player.flipGravity();
    expect(player.targetRail).toBe(RAIL_RIGHT);
    expect(player.isFlipping).toBe(true);

    // Apply micro-drag offset of +25px
    player.applyMicroDrag(25);
    expect(player.dragOffset).toBe(25);

    const expectedTargetX = player.rightRailX + 25; // 320 + 25 = 345

    // Run 120 physics sub-steps (1.0 second at 120Hz)
    for (let i = 0; i < 120; i++) {
      player.update(1 / 120);
    }

    expect(player.targetRail).toBe(RAIL_RIGHT);
    expect(player.currentRail).toBe(RAIL_RIGHT);
    expect(player.isFlipping).toBe(false);
    expect(player.x).toBe(expectedTargetX);
  });

  it('Flipping gravity while actively applying negative micro-drag (-20px) converges cleanly', () => {
    const player = new Player({ leftRailX: 80, rightRailX: 320, maxDragOffset: 35 });

    // Set player to right rail first
    player.flipGravity();
    for (let i = 0; i < 120; i++) player.update(1 / 120);
    expect(player.currentRail).toBe(RAIL_RIGHT);
    expect(player.isFlipping).toBe(false);

    // Flip back to left rail
    player.flipGravity();
    expect(player.targetRail).toBe(RAIL_LEFT);
    expect(player.isFlipping).toBe(true);

    // Apply negative micro-drag offset of -20px
    player.applyMicroDrag(-20);
    expect(player.dragOffset).toBe(-20);

    const expectedTargetX = player.leftRailX - 20; // 80 - 20 = 60

    for (let i = 0; i < 120; i++) {
      player.update(1 / 120);
    }

    expect(player.targetRail).toBe(RAIL_LEFT);
    expect(player.currentRail).toBe(RAIL_LEFT);
    expect(player.isFlipping).toBe(false);
    expect(player.x).toBe(expectedTargetX);
  });

  it('Micro-drag clamped to maxDragOffset (+35px) during flip arrives and clamps cleanly', () => {
    const player = new Player({ leftRailX: 80, rightRailX: 320, maxDragOffset: 35 });

    player.flipGravity();
    // Apply excessive drag that exceeds clamp bounds (+100px)
    player.applyMicroDrag(100);
    expect(player.dragOffset).toBe(35);

    const expectedTargetX = player.rightRailX + 35; // 320 + 35 = 355

    for (let i = 0; i < 120; i++) {
      player.update(1 / 120);
    }

    expect(player.currentRail).toBe(RAIL_RIGHT);
    expect(player.isFlipping).toBe(false);
    expect(player.x).toBe(expectedTargetX);
  });
});

describe('Polling-Only Touch Controller Fallback Support', () => {
  it('Falls back to consumeInput polling when a touch controller without callbacks is provided', () => {
    const player = new Player();
    let polled = false;
    const pollingController = {
      consumeInput: () => {
        polled = true;
        return { flipGravity: true, dragX: 10, dragY: 0, virtualX: 200, virtualY: 400, active: true };
      }
    };

    const game = new GameEngine(null, {
      player,
      touchController: pollingController
    });

    game.startPlaying();
    expect(player.targetRail).toBe(RAIL_LEFT);

    game.update(1 / 120);

    expect(polled).toBe(true);
    expect(player.targetRail).toBe(RAIL_RIGHT);
    expect(player.dragOffset).toBe(10);
  });
});
