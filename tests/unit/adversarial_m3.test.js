import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ScoreManager, StorageController, STORAGE_KEY, POINTS_PER_NEAR_MISS, SURVIVAL_POINTS_PER_SEC } from '../../src/score.js';
import { ShareController, sanitizeChallengerName, parseChallengeParams } from '../../src/share.js';
import { UIManager } from '../../src/ui.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { SoundEngine } from '../../src/audio.js';

// DOM mock helper conforming to project test architecture
function createMockElement(id = '', tag = 'div', onIdChange = null) {
  const classListSet = new Set();
  const attributes = {};
  const listeners = {};
  const children = [];
  let _id = id;

  const el = {
    tagName: tag.toUpperCase(),
    textContent: '',
    innerHTML: '',
    style: {},
    onclick: null,
    parentNode: null,
    classList: {
      add: vi.fn((...classes) => classes.forEach(c => classListSet.add(c))),
      remove: vi.fn((...classes) => classes.forEach(c => classListSet.delete(c))),
      contains: vi.fn((c) => classListSet.has(c)),
      toggle: vi.fn((c) => {
        if (classListSet.has(c)) {
          classListSet.delete(c);
          return false;
        }
        classListSet.add(c);
        return true;
      })
    },
    setAttribute: vi.fn((k, v) => { attributes[k] = String(v); }),
    getAttribute: vi.fn((k) => attributes[k] || null),
    removeAttribute: vi.fn((k) => { delete attributes[k]; }),
    addEventListener: vi.fn((evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    }),
    removeEventListener: vi.fn((evt, fn) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(f => f !== fn);
      }
    }),
    click: vi.fn(() => {
      if (typeof el.onclick === 'function') {
        el.onclick({ stopPropagation: vi.fn() });
      }
      if (listeners['click']) {
        listeners['click'].forEach(fn => fn({ stopPropagation: vi.fn() }));
      }
    }),
    appendChild: vi.fn((child) => {
      children.push(child);
      child.parentNode = el;
      return child;
    }),
    removeChild: vi.fn((child) => {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    }),
    remove: vi.fn(() => {
      if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      }
    }),
    select: vi.fn(),
    focus: vi.fn(),
    get children() { return children; }
  };

  Object.defineProperty(el, 'id', {
    configurable: true,
    get: () => _id,
    set: (v) => {
      const old = _id;
      _id = v;
      if (onIdChange) onIdChange(v, old, el);
    }
  });

  return el;
}

function setupMockDocument() {
  const elements = {};

  const getOrCreate = (id, tag = 'div') => {
    if (!elements[id]) {
      const el = createMockElement(id, tag, (newId, oldId, element) => {
        if (oldId && elements[oldId] === element) {
          delete elements[oldId];
        }
        if (newId) elements[newId] = element;
      });
      elements[id] = el;
    }
    return elements[id];
  };

  const body = createMockElement('body', 'body');

  const expectedIds = [
    'game-container', 'challenge-banner', 'challenge-text', 'hud-top',
    'hud-score', 'hud-multiplier', 'hud-best', 'start-screen',
    'game-over-screen', 'new-record-badge', 'game-over-score',
    'game-over-best', 'summary-score', 'summary-best',
    'challenge-result-row', 'summary-challenge', 'btn-replay',
    'btn-retry', 'btn-share-score', 'btn-share', 'toast-container'
  ];

  for (const id of expectedIds) {
    const el = getOrCreate(id);
    body.appendChild(el);
  }

  elements['challenge-banner'].classList.add('hidden');
  elements['game-over-screen'].classList.add('hidden');
  elements['new-record-badge'].classList.add('hidden');
  elements['challenge-result-row'].classList.add('hidden');
  elements['hud-score'].textContent = '0';
  elements['hud-multiplier'].textContent = '1x';
  elements['hud-best'].textContent = '0';
  elements['game-over-score'].textContent = '0';
  elements['game-over-best'].textContent = '0';

  const doc = {
    body,
    getElementById: vi.fn((id) => {
      return elements[id] || null;
    }),
    createElement: vi.fn((tag) => {
      const el = createMockElement('', tag, (newId, oldId, element) => {
        if (oldId && elements[oldId] === element) {
          delete elements[oldId];
        }
        if (newId) elements[newId] = element;
      });
      const originalRemove = el.remove;
      el.remove = vi.fn(() => {
        if (el.id && elements[el.id] === el) {
          delete elements[el.id];
        }
        originalRemove();
      });
      return el;
    }),
    execCommand: vi.fn(() => true)
  };

  return { doc, elements };
}

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

/* ==========================================================================
   SUITE 1: Adversarial StorageController Stress Tests
   ========================================================================== */
describe('Adversarial StorageController Stress Tests', () => {
  it('1.1 Handles corrupt strings, deep structures, and arbitrary non-numeric values without throwing', () => {
    const corruptInputs = [
      '{broken: true, [1,2,',
      '{"a":'.repeat(200) + '1' + '}'.repeat(200),
      '[object Object]',
      '{"score": "NaN"}',
      '{"score": null}',
      '[100, 200, 300]',
      'null',
      'undefined',
      'NaN',
      'Infinity',
      '-Infinity',
      '-9999999',
      '0',
      '-0',
      '0.0',
      '   ',
      '\t\r\n',
      '🔥9999',
      '💥crash'
    ];

    for (const corrupt of corruptInputs) {
      const mockStorage = {
        getItem: vi.fn(() => corrupt),
        setItem: vi.fn()
      };
      const storageCtrl = new StorageController(mockStorage);
      expect(() => storageCtrl.getHighScore()).not.toThrow();
      const val = storageCtrl.getHighScore();
      expect(Number.isFinite(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });

  it('1.2 Handles massive 10MB payloads without crashing or throwing', () => {
    // 10MB payload of non-numeric JSON structure
    const largePayload = '{"data":"' + 'X'.repeat(10 * 1024 * 1024) + '"}';
    const mockStorage = {
      getItem: vi.fn(() => largePayload),
      setItem: vi.fn()
    };
    const storageCtrl = new StorageController(mockStorage);
    const start = Date.now();
    expect(() => storageCtrl.getHighScore()).not.toThrow();
    const score = storageCtrl.getHighScore();
    const elapsed = Date.now() - start;

    expect(score).toBe(0);
    expect(elapsed).toBeLessThan(1000); // Must resolve rapidly without hanging
  });

  it('1.3 Handles massive string of digits (100KB) returning safe integer or fallback', () => {
    // 100,000 '9' digits (exceeds IEEE 754 float, returns Infinity in parseInt)
    const largeDigitString = '9'.repeat(100000);
    const mockStorage = {
      getItem: vi.fn(() => largeDigitString),
      setItem: vi.fn()
    };
    const storageCtrl = new StorageController(mockStorage);
    expect(() => storageCtrl.getHighScore()).not.toThrow();
    const val = storageCtrl.getHighScore();
    expect(Number.isFinite(val)).toBe(true);
  });

  it('1.4 Handles read-only storage throwing SecurityError on read and write', () => {
    const securityError = new Error('SecurityError: The operation is insecure.');
    securityError.name = 'SecurityError';

    const mockStorage = {
      getItem: vi.fn(() => { throw securityError; }),
      setItem: vi.fn(() => { throw securityError; })
    };
    const storageCtrl = new StorageController(mockStorage);

    // Read with SecurityError
    expect(() => storageCtrl.getHighScore()).not.toThrow();
    expect(storageCtrl.getHighScore()).toBe(0);

    // Write with SecurityError -> in-memory fallback saves score
    expect(() => {
      const saved = storageCtrl.saveHighScore(2500);
      expect(saved).toBe(true);
    }).not.toThrow();
    expect(storageCtrl.getHighScore()).toBe(2500);

    // Monotonic enforcement still active on in-memory fallback
    expect(storageCtrl.saveHighScore(1000)).toBe(false);
    expect(storageCtrl.getHighScore()).toBe(2500);
  });

  it('1.5 Handles QuotaExceededError while preserving in-memory state and monotonicity', () => {
    const quotaError = new Error('QuotaExceededError: Storage quota has been exceeded.');
    quotaError.name = 'QuotaExceededError';

    let storedValue = null;
    const mockStorage = {
      getItem: vi.fn(() => storedValue),
      setItem: vi.fn(() => { throw quotaError; })
    };
    const storageCtrl = new StorageController(mockStorage);

    expect(storageCtrl.saveHighScore(8888)).toBe(true);
    expect(storageCtrl.getHighScore()).toBe(8888);

    // Attempting to overwrite with smaller score returns false
    expect(storageCtrl.saveHighScore(5000)).toBe(false);
    expect(storageCtrl.getHighScore()).toBe(8888);
  });

  it('1.6 Synchronizes concurrent writes across multiple StorageController instances', () => {
    const sharedData = {};
    const createStorageMock = () => ({
      getItem: vi.fn((k) => sharedData[k] || null),
      setItem: vi.fn((k, v) => { sharedData[k] = String(v); }),
      removeItem: vi.fn((k) => { delete sharedData[k]; })
    });

    const instanceA = new StorageController(createStorageMock());
    const instanceB = new StorageController(createStorageMock());

    // Instance A saves 1000
    expect(instanceA.saveHighScore(1000)).toBe(true);
    expect(instanceB.getHighScore()).toBe(1000);

    // Instance B saves 2500
    expect(instanceB.saveHighScore(2500)).toBe(true);
    expect(sharedData[STORAGE_KEY]).toBe('2500');

    // Instance A tries to save 1800 -> must fail because shared storage has 2500
    expect(instanceA.saveHighScore(1800)).toBe(false);
    expect(instanceA.getHighScore()).toBe(2500);
  });

  it('1.7 Strict numeric validation and integer boundary tests', () => {
    const store = {};
    const mockStorage = {
      getItem: vi.fn((k) => store[k] || null),
      setItem: vi.fn((k, v) => { store[k] = String(v); })
    };
    const storageCtrl = new StorageController(mockStorage);

    // Non-positive or invalid inputs rejected
    expect(storageCtrl.saveHighScore(0)).toBe(false);
    expect(storageCtrl.saveHighScore(-100)).toBe(false);
    expect(storageCtrl.saveHighScore(NaN)).toBe(false);
    expect(storageCtrl.saveHighScore(Infinity)).toBe(false);
    expect(storageCtrl.saveHighScore(-Infinity)).toBe(false);

    // Floats are floored
    expect(storageCtrl.saveHighScore(450.9)).toBe(true);
    expect(storageCtrl.getHighScore()).toBe(450);

    // Large score (> 1B points)
    expect(storageCtrl.saveHighScore(1500000000)).toBe(true);
    expect(storageCtrl.getHighScore()).toBe(1500000000);

    // Score beyond 32-bit signed integer boundary (> 2^31 - 1 = 2,147,483,647)
    expect(storageCtrl.saveHighScore(3000000000)).toBe(true);
    expect(storageCtrl.getHighScore()).toBe(3000000000);

    // Number.MAX_SAFE_INTEGER (9,007,199,254,740,991)
    expect(storageCtrl.saveHighScore(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(storageCtrl.getHighScore()).toBe(Number.MAX_SAFE_INTEGER);
  });
});

/* ==========================================================================
   SUITE 2: Adversarial ScoreManager Stress Tests
   ========================================================================== */
describe('Adversarial ScoreManager Stress Tests', () => {
  let scoreManager;
  let mockStorage;

  beforeEach(() => {
    mockStorage = {
      data: {},
      getItem: vi.fn((k) => mockStorage.data[k] || null),
      setItem: vi.fn((k, v) => { mockStorage.data[k] = String(v); }),
      removeItem: vi.fn((k) => { delete mockStorage.data[k]; })
    };
    const storageCtrl = new StorageController(mockStorage);
    scoreManager = new ScoreManager({ storageController: storageCtrl, comboDuration: 2.5, maxMultiplier: 10 });
  });

  it('2.1 Rapid near-miss burst (100 events in 1 second) maintains strict multiplier cap and exact score', () => {
    let totalAwarded = 0;
    const dt = 1 / 100; // 100 events over 1.0 second

    for (let i = 0; i < 100; i++) {
      const pts = scoreManager.addNearMiss();
      totalAwarded += pts;
      scoreManager.update(dt);
      expect(scoreManager.multiplier).toBeLessThanOrEqual(10);
      expect(scoreManager.comboTimer).toBeGreaterThan(0);
    }

    // Multiplier must be exactly 10
    expect(scoreManager.multiplier).toBe(10);

    // Near-miss points formula:
    // Event 1: 50 * 2 = 100
    // Event 2: 50 * 3 = 150
    // ...
    // Event 9: 50 * 10 = 500
    // Events 10 to 100 (91 events): 50 * 10 = 500 each
    // Sum = (100 + 150 + 200 + 250 + 300 + 350 + 400 + 450 + 500) + (91 * 500) = 2700 + 45500 = 48200
    expect(totalAwarded).toBe(48200);

    // Plus continuous survival points added during 1.0s
    expect(scoreManager.score).toBeGreaterThanOrEqual(48200);

    // Multiplier stays elevated for another 2.4s
    scoreManager.update(2.4);
    expect(scoreManager.multiplier).toBe(10);

    // Multiplier drops back to 1x once combo duration expires
    scoreManager.update(0.2);
    expect(scoreManager.multiplier).toBe(1);
    expect(scoreManager.comboTimer).toBe(0);
  });

  it('2.2 Score handles > 1B points and 32-bit signed integer limits without wrapping or overflow', () => {
    // Set score past 2^31 - 1 (2,147,483,647)
    scoreManager.score = 2500000000;

    // Award near-miss at 2.5B
    const pts = scoreManager.addNearMiss();
    expect(pts).toBe(100);
    expect(scoreManager.score).toBe(2500000100);

    // Award continuous survival points (+10 * multiplier / sec)
    scoreManager.update(1.0);
    expect(scoreManager.score).toBe(2500000120);

    // Commit to storage
    const saved = scoreManager.saveHighScore();
    expect(saved).toBe(true);
    expect(scoreManager.highScore).toBe(2500000120);
    expect(mockStorage.data[STORAGE_KEY]).toBe('2500000120');
  });

  it('2.3 Accumulation precision across 72,000 sub-steps (600s / 10 minutes at 120Hz) has 0 drift', () => {
    const dt = 1 / 120;
    const totalSteps = 72000; // 600 seconds of continuous 120Hz gameplay
    const expectedPoints = 600 * SURVIVAL_POINTS_PER_SEC; // 6,000 points at 1x multiplier

    for (let i = 0; i < totalSteps; i++) {
      scoreManager.update(dt);
    }

    // Cumulative points must match expected points within floating-point epsilon (at most 1 remainder)
    const diff = Math.abs(scoreManager.score - expectedPoints);
    expect(diff).toBeLessThanOrEqual(1);
  });

  it('2.4 High multiplier (10x) accumulation precision across 7,200 sub-steps (60s at 120Hz)', () => {
    scoreManager.multiplier = 10;
    scoreManager.comboTimer = 1000; // Keep alive for test
    const dt = 1 / 120;
    const totalSteps = 7200; // 60 seconds
    const expectedPoints = 60 * SURVIVAL_POINTS_PER_SEC * 10; // 6,000 points

    for (let i = 0; i < totalSteps; i++) {
      scoreManager.update(dt);
    }

    const diff = Math.abs(scoreManager.score - expectedPoints);
    expect(diff).toBeLessThanOrEqual(1);
  });

  it('2.5 Tolerates adversarial dt inputs (negative, NaN, Infinity, 0) without corrupting state', () => {
    scoreManager.score = 1000;
    scoreManager.multiplier = 4;
    scoreManager.comboTimer = 2.0;

    scoreManager.update(-1.0);
    expect(scoreManager.score).toBe(1000);
    expect(scoreManager.comboTimer).toBe(2.0);

    scoreManager.update(0);
    expect(scoreManager.score).toBe(1000);
    expect(scoreManager.comboTimer).toBe(2.0);

    scoreManager.update(NaN);
    expect(scoreManager.score).toBe(1000);
    expect(scoreManager.comboTimer).toBe(2.0);

    scoreManager.update(Infinity);
    expect(scoreManager.score).toBe(1000);
    expect(scoreManager.comboTimer).toBe(2.0);
  });
});

/* ==========================================================================
   SUITE 3: Challenge Beaten Trigger & Fanfare Idempotency
   ========================================================================== */
describe('Challenge Beaten Trigger & Fanfare Idempotency', () => {
  let canvas;
  let game;
  let mockSound;
  let originalDocDesc;

  beforeEach(() => {
    const { doc } = setupMockDocument();
    originalDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });

    canvas = createMockCanvas();
    mockSound = {
      ensureContext: vi.fn(),
      playJump: vi.fn(),
      playCombo: vi.fn(),
      playNearMiss: vi.fn(),
      playCrash: vi.fn(),
      playFanfare: vi.fn()
    };
    game = new GameEngine(canvas, { soundEngine: mockSound });
  });

  afterEach(() => {
    if (originalDocDesc) {
      Object.defineProperty(globalThis, 'document', originalDocDesc);
    } else {
      delete globalThis.document;
    }
  });

  it('3.1 Exact score tie does NOT beat challenge; strictly +1 surpasses and beats challenge', () => {
    game.scoreManager.setChallengeTarget(1000);
    game.startPlaying();

    // 1. Below target (999)
    game.score = 999;
    game.update(1 / 120);
    expect(game.scoreManager.isChallengeBeaten).toBe(false);
    expect(mockSound.playFanfare).not.toHaveBeenCalled();

    // 2. Exact score tie (1000) -> MUST NOT trigger challenge beaten
    game.score = 1000;
    game.update(1 / 120);
    expect(game.scoreManager.isChallengeBeaten).toBe(false);
    expect(mockSound.playFanfare).not.toHaveBeenCalled();
    const challengeBanner = document.getElementById('challenge-banner');
    expect(challengeBanner.classList.contains('target-crushed')).toBe(false);

    // 3. Exactly +1 surpassing score (1001) -> MUST trigger challenge beaten
    game.score = 1001;
    game.update(1 / 120);
    expect(game.scoreManager.isChallengeBeaten).toBe(true);
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);
    expect(challengeBanner.classList.contains('target-crushed')).toBe(true);
    const challengeText = document.getElementById('challenge-text');
    expect(challengeText.textContent).toBe('🏆 Target Crushed!');
  });

  it('3.2 Fanfare triggers ONLY ONCE per gameplay session across thousands of ticks and game over', () => {
    game.scoreManager.setChallengeTarget(500);
    game.startPlaying();

    // Pass target
    game.score = 501;
    game.update(1 / 120);
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);

    // Simulate 500 subsequent frames (approx 4 seconds at 120Hz)
    for (let frame = 0; frame < 500; frame++) {
      game.score += 5;
      game.update(1 / 120);
    }
    // Fanfare MUST NOT repeat during continuous frames
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);

    // Trigger Game Over
    game.triggerGameOver();

    // Fanfare MUST NOT re-trigger on Game Over if already celebrated during session
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);
  });

  it('3.3 Fanfare plays once on Game Over if new high score achieved without challenge target', () => {
    game.storage.saveHighScore(200);
    game.scoreManager.highScore = 200;
    game.startPlaying();

    game.score = 450;
    game.update(1 / 120);
    // No challenge target, so fanfare doesn't play during gameplay
    expect(mockSound.playFanfare).not.toHaveBeenCalled();

    // Game over -> new high score badge triggers fanfare
    game.triggerGameOver();
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);
    expect(document.getElementById('new-record-badge').classList.contains('hidden')).toBe(false);
  });

  it('3.4 Verifies fanfare triggers only once per session even across multiple attempts and replays', () => {
    game.storage.saveHighScore(500);
    game.scoreManager.highScore = 500;
    game.scoreManager.setChallengeTarget(300);

    // Attempt 1: Player plays but does not beat challenge (score 250 < 300) and does not beat high score (250 < 500)
    game.startPlaying();
    game.score = 250;
    game.update(1 / 120);
    game.triggerGameOver();
    // Fanfare must NOT have played yet
    expect(mockSound.playFanfare).not.toHaveBeenCalled();

    // Replay for Attempt 2
    const btnReplay = document.getElementById('btn-replay');
    btnReplay.click();
    expect(game.state).toBe(STATE_PLAYING);
    expect(game.score).toBe(0);

    // Attempt 2: Player surpasses target (score 350 > 300)
    game.score = 350;
    game.update(1 / 120);
    // Fanfare plays once!
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);
    game.triggerGameOver();
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);

    // Attempt 3: Player replays after already crushing challenge in this session
    btnReplay.click();
    expect(game.state).toBe(STATE_PLAYING);
    expect(game.score).toBe(0);

    // Surpass target again in Attempt 3
    game.score = 400;
    game.update(1 / 120);
    // Fanfare MUST NOT re-trigger; once per session rule is strictly preserved
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);
  });

  it('3.5 Malformed or non-positive challenge targets are safely rejected', () => {
    const invalidTargets = [0, -100, -1, NaN, Infinity, 'invalid', null, undefined];
    for (const target of invalidTargets) {
      game.scoreManager.setChallengeTarget(target);
      expect(game.scoreManager.challengeTarget).toBeNull();
      expect(game.scoreManager.isChallengeBeaten).toBe(false);
    }
  });
});
