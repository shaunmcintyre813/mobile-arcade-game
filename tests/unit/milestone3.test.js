import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ScoreManager, StorageController, STORAGE_KEY, POINTS_PER_NEAR_MISS, SURVIVAL_POINTS_PER_SEC } from '../../src/score.js';
import { ShareController, sanitizeChallengerName, parseChallengeParams } from '../../src/share.js';
import { UIManager } from '../../src/ui.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { SoundEngine } from '../../src/audio.js';

// Realistic lightweight in-memory DOM Node implementation for Node testing
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

describe('Milestone 3: ScoreManager & Multiplier / Combo Decay Logic', () => {
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
    scoreManager = new ScoreManager({ storageController: storageCtrl, comboDuration: 2.5 });
  });

  it('initializes with score 0, multiplier 1, and zero combo timer', () => {
    expect(scoreManager.score).toBe(0);
    expect(scoreManager.multiplier).toBe(1);
    expect(scoreManager.comboTimer).toBe(0);
    expect(scoreManager.highScore).toBe(0);
    expect(scoreManager.isNewHighScore).toBe(false);
    expect(scoreManager.isChallengeBeaten).toBe(false);
  });

  it('increments multiplier and awards +50 * multiplier on near-miss', () => {
    // 1st near miss: multiplier becomes 2, points = 50 * 2 = 100
    const pts1 = scoreManager.addNearMiss();
    expect(pts1).toBe(100);
    expect(scoreManager.multiplier).toBe(2);
    expect(scoreManager.score).toBe(100);
    expect(scoreManager.comboTimer).toBe(2.5);

    // 2nd near miss: multiplier becomes 3, points = 50 * 3 = 150
    const pts2 = scoreManager.addNearMiss();
    expect(pts2).toBe(150);
    expect(scoreManager.multiplier).toBe(3);
    expect(scoreManager.score).toBe(250);
    expect(scoreManager.comboTimer).toBe(2.5);
  });

  it('caps multiplier at 10x maximum even with excessive near misses', () => {
    for (let i = 0; i < 15; i++) {
      scoreManager.addNearMiss();
    }
    expect(scoreManager.multiplier).toBe(10);
    // An additional near miss at 10x awards 50 * 10 = 500 points
    const beforeScore = scoreManager.score;
    const pts = scoreManager.addNearMiss();
    expect(pts).toBe(500);
    expect(scoreManager.multiplier).toBe(10);
    expect(scoreManager.score).toBe(beforeScore + 500);
  });

  it('decays multiplier back to 1x when combo decay timer expires', () => {
    scoreManager.addNearMiss(); // Multiplier is 2, timer = 2.5
    expect(scoreManager.multiplier).toBe(2);

    // Update with 1.5 seconds: timer remaining = 1.0s, multiplier still 2
    scoreManager.update(1.5);
    expect(scoreManager.multiplier).toBe(2);
    expect(scoreManager.comboTimer).toBeCloseTo(1.0, 2);

    // Update with additional 1.1 seconds: timer expires, multiplier resets to 1x
    scoreManager.update(1.1);
    expect(scoreManager.multiplier).toBe(1);
    expect(scoreManager.comboTimer).toBe(0);
  });

  it('accumulates continuous survival points (+10 * multiplier / sec)', () => {
    // Multiplier 1x: 1.0 second should add 10 points
    scoreManager.update(1.0);
    expect(scoreManager.score).toBe(10);

    // Multiplier 3x: 1.0 second should add 30 points
    scoreManager.multiplier = 3;
    scoreManager.comboTimer = 2.5;
    scoreManager.update(1.0);
    expect(scoreManager.score).toBe(40);
  });

  it('accurately accumulates fractional survival points across 120Hz sub-steps', () => {
    const initialScore = scoreManager.score;
    const dt = 1 / 120;
    // Simulate 120 sub-steps (exactly 1.0 second) at 1x multiplier
    for (let i = 0; i < 120; i++) {
      scoreManager.update(dt);
    }
    expect(scoreManager.score - initialScore).toBe(SURVIVAL_POINTS_PER_SEC);
  });

  it('detects when score exceeds initial high score and challenge target', () => {
    scoreManager.highScore = 500;
    scoreManager.setChallengeTarget(600);

    scoreManager.score = 400;
    expect(scoreManager.checkHighScore()).toBe(false);
    expect(scoreManager.checkChallengeBeaten()).toBe(false);

    scoreManager.score = 550;
    expect(scoreManager.checkHighScore()).toBe(true);
    expect(scoreManager.checkChallengeBeaten()).toBe(false);

    scoreManager.score = 650;
    expect(scoreManager.checkHighScore()).toBe(true);
    expect(scoreManager.checkChallengeBeaten()).toBe(true);
    expect(scoreManager.isChallengeBeaten).toBe(true);
  });

  it('reset cleanly restores all score and combo state', () => {
    scoreManager.addNearMiss();
    scoreManager.score = 1200;
    scoreManager.isNewHighScore = true;
    scoreManager.isChallengeBeaten = true;

    scoreManager.reset();
    expect(scoreManager.score).toBe(0);
    expect(scoreManager.multiplier).toBe(1);
    expect(scoreManager.comboTimer).toBe(0);
    expect(scoreManager.isNewHighScore).toBe(false);
    expect(scoreManager.isChallengeBeaten).toBe(false);
  });
});

describe('Milestone 3: StorageController & LocalStorage Resilience', () => {
  it('returns 0 when storage is empty', () => {
    const mockStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
    const storageCtrl = new StorageController(mockStorage);
    expect(storageCtrl.getHighScore()).toBe(0);
  });

  it('persists and retrieves high score under antigravity_high_score', () => {
    const store = {};
    const mockStorage = {
      getItem: vi.fn((k) => store[k] || null),
      setItem: vi.fn((k, v) => { store[k] = String(v); }),
      removeItem: vi.fn((k) => { delete store[k]; })
    };
    const storageCtrl = new StorageController(mockStorage);

    const saved = storageCtrl.saveHighScore(850);
    expect(saved).toBe(true);
    expect(mockStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '850');
    expect(storageCtrl.getHighScore()).toBe(850);
  });

  it('is strictly monotonic and ignores lower or equal scores', () => {
    const store = { [STORAGE_KEY]: '1000' };
    const mockStorage = {
      getItem: vi.fn((k) => store[k]),
      setItem: vi.fn((k, v) => { store[k] = String(v); })
    };
    const storageCtrl = new StorageController(mockStorage);

    expect(storageCtrl.saveHighScore(500)).toBe(false);
    expect(storageCtrl.saveHighScore(1000)).toBe(false);
    expect(mockStorage.setItem).not.toHaveBeenCalled();
    expect(storageCtrl.getHighScore()).toBe(1000);
  });

  it('safely recovers from corrupted strings and JSON payloads without throwing', () => {
    const corruptInputs = ['{invalid_json', 'NaN', 'undefined', '-500', 'not_a_number', '   '];
    for (const corrupt of corruptInputs) {
      const mockStorage = {
        getItem: vi.fn(() => corrupt),
        setItem: vi.fn()
      };
      const storageCtrl = new StorageController(mockStorage);
      expect(() => storageCtrl.getHighScore()).not.toThrow();
      expect(storageCtrl.getHighScore()).toBe(0);
    }
  });

  it('handles QuotaExceededError by gracefully falling back to in-memory score', () => {
    const mockStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      })
    };
    const storageCtrl = new StorageController(mockStorage);

    expect(() => storageCtrl.saveHighScore(1450)).not.toThrow();
    // Subsequent read returns the in-memory fallback
    expect(storageCtrl.getHighScore()).toBe(1450);
  });

  it('gracefully handles completely disabled or security-restricted storage', () => {
    const mockStorage = {
      getItem: vi.fn(() => { throw new Error('SecurityError: Access denied'); }),
      setItem: vi.fn(() => { throw new Error('SecurityError: Access denied'); })
    };
    const storageCtrl = new StorageController(mockStorage);

    expect(storageCtrl.getHighScore()).toBe(0);
    expect(() => storageCtrl.saveHighScore(720)).not.toThrow();
    expect(storageCtrl.getHighScore()).toBe(720);
  });
});

describe('Milestone 3: Web Share API & Silent AbortError Handling', () => {
  let shareController;
  let originalNavigatorDesc;
  let originalDocDesc;

  beforeEach(() => {
    const { doc } = setupMockDocument();
    originalDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });

    originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    shareController = new ShareController();
  });

  afterEach(() => {
    if (originalDocDesc) {
      Object.defineProperty(globalThis, 'document', originalDocDesc);
    } else {
      delete globalThis.document;
    }

    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    } else {
      delete globalThis.navigator;
    }
  });

  it('invokes navigator.share with correct title, text, and challenge URL parameters', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { share: shareMock },
      configurable: true,
      writable: true
    });

    const res = await shareController.shareScore({ score: 1250, playerName: 'Alex' });

    expect(shareMock).toHaveBeenCalledTimes(1);
    const payload = shareMock.mock.calls[0][0];
    expect(payload.title).toBe('AntiGravity: Neon Pulse');
    expect(payload.text).toBe('Can you beat my score of 1250 in AntiGravity?');
    expect(payload.url).toContain('?c=1250&by=Alex');
    expect(res).toEqual({ success: true, method: 'web-share', cancelled: false });
  });

  it('silently suppresses AbortError when user dismisses native share sheet', async () => {
    const abortError = new Error('The user dismissed the share dialog.');
    abortError.name = 'AbortError';
    const shareMock = vi.fn().mockRejectedValue(abortError);
    const clipboardMock = vi.fn();

    Object.defineProperty(globalThis, 'navigator', {
      value: { share: shareMock, clipboard: { writeText: clipboardMock } },
      configurable: true,
      writable: true
    });

    const res = await shareController.shareScore({ score: 900, playerName: 'Sam' });

    expect(res).toEqual({ success: false, method: 'web-share', cancelled: true });
    // Crucial: Must NOT trigger clipboard fallback and must NOT display toast
    expect(clipboardMock).not.toHaveBeenCalled();
    const toast = document.getElementById('game-toast');
    expect(toast).toBeNull();
  });
});

describe('Milestone 3: Clipboard Fallback & Toast UI Notification', () => {
  let shareController;
  let originalNavigatorDesc;
  let originalDocDesc;

  beforeEach(() => {
    const { doc } = setupMockDocument();
    originalDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });

    originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    shareController = new ShareController();
  });

  afterEach(() => {
    if (originalDocDesc) {
      Object.defineProperty(globalThis, 'document', originalDocDesc);
    } else {
      delete globalThis.document;
    }

    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    } else {
      delete globalThis.navigator;
    }
  });

  it('executes navigator.clipboard.writeText when navigator.share is unsupported', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: writeTextMock } },
      configurable: true,
      writable: true
    });

    const res = await shareController.shareScore({ score: 1500, playerName: 'NeonRider' });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0][0]).toContain('?c=1500&by=NeonRider');
    expect(res).toEqual({ success: true, method: 'clipboard', cancelled: false });

    // Toast notification rendered
    const toast = document.getElementById('game-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('📋 Challenge link copied to clipboard!');
    expect(toast.getAttribute('role')).toBe('status');
  });

  it('falls back to clipboard when navigator.share throws a non-AbortError', async () => {
    const typeError = new TypeError('Share failed for unknown reasons');
    const shareMock = vi.fn().mockRejectedValue(typeError);
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(globalThis, 'navigator', {
      value: { share: shareMock, clipboard: { writeText: writeTextMock } },
      configurable: true,
      writable: true
    });

    const res = await shareController.shareScore({ score: 2000 });

    expect(shareMock).toHaveBeenCalled();
    expect(writeTextMock).toHaveBeenCalled();
    expect(res.method).toBe('clipboard');
    expect(document.getElementById('game-toast')).not.toBeNull();
  });

  it('dismisses toast notification and cleans up cleanly', () => {
    vi.useFakeTimers();
    const toast = shareController.showToast('Test Toast', 2000);

    expect(document.getElementById('game-toast')).toBe(toast);
    expect(toast.classList.contains('fade-out')).toBe(false);

    // Fast-forward past duration
    vi.advanceTimersByTime(2000);
    expect(toast.classList.contains('fade-out')).toBe(true);

    // Fast-forward past transition
    vi.advanceTimersByTime(350);
    expect(document.getElementById('game-toast')).toBeNull();
    vi.useRealTimers();
  });
});

describe('Milestone 3: Challenge URL Generation & Parsing with XSS Protection', () => {
  it('generates well-formed challenge URLs with encoded parameters', () => {
    const shareController = new ShareController();
    const url = shareController.generateChallengeUrl(1250, 'Cyber Champion');
    expect(url).toContain('?c=1250&by=Cyber%20Champion');
  });

  it('correctly parses valid challenge parameters (?c=1250&by=Alex)', () => {
    const parsed = parseChallengeParams('?c=1250&by=Alex');
    expect(parsed).toEqual({
      hasChallenge: true,
      targetScore: 1250,
      challengerName: 'Alex'
    });
  });

  it('supports alias parameter format (?score=4500&challenger=Jordan)', () => {
    const parsed = parseChallengeParams('?score=4500&challenger=Jordan');
    expect(parsed).toEqual({
      hasChallenge: true,
      targetScore: 4500,
      challengerName: 'Jordan'
    });
  });

  it('strictly bounds target score to positive integer (1 to 9,999,999)', () => {
    // Non-positive or out of range scores must be rejected
    expect(parseChallengeParams('?c=0&by=Alex').hasChallenge).toBe(false);
    expect(parseChallengeParams('?c=-100&by=Alex').hasChallenge).toBe(false);
    expect(parseChallengeParams('?c=10000000&by=Alex').hasChallenge).toBe(false);
    expect(parseChallengeParams('?c=NaN&by=Alex').hasChallenge).toBe(false);
    expect(parseChallengeParams('?c=abc&by=Alex').hasChallenge).toBe(false);
    expect(parseChallengeParams('?c=12.5&by=Alex').hasChallenge).toBe(false);

    // Maximum allowed score
    expect(parseChallengeParams('?c=9999999&by=Alex')).toEqual({
      hasChallenge: true,
      targetScore: 9999999,
      challengerName: 'Alex'
    });
  });

  it('strictly sanitizes XSS payloads and truncates names to 20 characters', () => {
    // Strip HTML script tags
    const scriptAttack = parseChallengeParams('?c=1000&by=<script>alert("xss")</script>');
    expect(scriptAttack.hasChallenge).toBe(true);
    expect(scriptAttack.challengerName).not.toContain('<script>');
    expect(scriptAttack.challengerName).not.toContain('</script>');

    // Strip image injection
    const imgAttack = parseChallengeParams('?c=1000&by=Alex<img src=x onerror=alert(1)>');
    expect(imgAttack.hasChallenge).toBe(true);
    expect(imgAttack.challengerName).not.toContain('<img');
    expect(imgAttack.challengerName).toContain('Alex');

    // Truncate to 20 characters
    const longName = parseChallengeParams('?c=1000&by=SuperLongChallengerNameExceedingTwenty');
    expect(longName.hasChallenge).toBe(true);
    expect(longName.challengerName.length).toBeLessThanOrEqual(20);

    // Fallback to 'Challenger' if name is stripped to empty
    const emptyAttack = parseChallengeParams('?c=1000&by=<script></script>');
    expect(emptyAttack.hasChallenge).toBe(true);
    expect(emptyAttack.challengerName).toBe('Challenger');
  });
});

describe('Milestone 3: GameEngine & UIManager Integration', () => {
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

  it('renders incoming challenge banner when URL has challenge parameters', () => {
    const ui = new UIManager({ soundEngine: mockSound });
    ui.showChallengeBanner({ targetScore: 1250, challengerName: 'Alex' });

    const banner = document.getElementById('challenge-banner');
    const text = document.getElementById('challenge-text');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(text.textContent).toContain('Alex');
    expect(text.textContent).toContain('1,250');
  });

  it('triggers celebration banner and SoundEngine.playFanfare() when challenge target is surpassed', () => {
    game.scoreManager.setChallengeTarget(500);
    game.startPlaying();

    expect(game.scoreManager.isChallengeBeaten).toBe(false);

    // Set score above target
    game.score = 550;
    game.update(1 / 120);

    expect(game.scoreManager.isChallengeBeaten).toBe(true);
    const challengeText = document.getElementById('challenge-text');
    expect(challengeText.textContent).toBe('🏆 Target Crushed!');
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);

    // Subsequent ticks must not spam fanfare
    game.update(1 / 120);
    expect(mockSound.playFanfare).toHaveBeenCalledTimes(1);
  });

  it('shows game over screen with scores, new high score badge, and fanfare on record broken', () => {
    game.storage.saveHighScore(100);
    game.scoreManager.highScore = 100;
    game.startPlaying();
    game.score = 800; // Beats record

    game.triggerGameOver();

    expect(game.state).toBe(STATE_GAME_OVER);
    const gameOverScreen = document.getElementById('game-over-screen');
    expect(gameOverScreen.classList.contains('hidden')).toBe(false);

    const scoreEl = document.getElementById('game-over-score');
    expect(scoreEl.textContent).toBe('800');

    const badge = document.getElementById('new-record-badge');
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(mockSound.playFanfare).toHaveBeenCalled();
  });

  it('wires replay button to reset game and restart playing', () => {
    game.startPlaying();
    game.score = 500;
    game.triggerGameOver();
    expect(game.state).toBe(STATE_GAME_OVER);

    const btnReplay = document.getElementById('btn-replay');
    btnReplay.click();

    expect(game.state).toBe(STATE_PLAYING);
    expect(game.score).toBe(0);
    expect(game.comboMultiplier).toBe(1);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(true);
  });

  it('wires share button to invoke ShareController.shareScore', () => {
    const shareScoreSpy = vi.spyOn(game.share, 'shareScore').mockResolvedValue({ success: true, method: 'web-share' });
    game.startPlaying();
    game.score = 750;
    game.triggerGameOver();

    const btnShare = document.getElementById('btn-share-score');
    btnShare.click();

    expect(shareScoreSpy).toHaveBeenCalledWith({ score: 750 });
  });
});
