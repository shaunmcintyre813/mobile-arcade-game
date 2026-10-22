import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import net from 'net';
import path from 'path';

import {
  ShareController,
  sanitizeChallengerName,
  parseChallengeParams
} from '../../src/share.js';
import { UIManager } from '../../src/ui.js';
import { createPreviewServer, ROOT } from '../../preview.js';

// ============================================================================
// Lightweight Mock DOM for Node In-Memory Adversarial Verification
// ============================================================================
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

  const requiredIds = [
    'game-container', 'challenge-banner', 'challenge-text', 'hud-top',
    'hud-score', 'hud-multiplier', 'hud-best', 'start-screen',
    'game-over-screen', 'new-record-badge', 'game-over-score',
    'game-over-best', 'summary-score', 'summary-best',
    'challenge-result-row', 'summary-challenge', 'btn-replay',
    'btn-retry', 'btn-share-score', 'btn-share', 'toast-container'
  ];

  for (const id of requiredIds) {
    const el = getOrCreate(id);
    body.appendChild(el);
  }

  elements['challenge-banner'].classList.add('hidden');
  elements['game-over-screen'].classList.add('hidden');
  elements['new-record-badge'].classList.add('hidden');
  elements['challenge-result-row'].classList.add('hidden');

  const doc = {
    body,
    getElementById: vi.fn((id) => elements[id] || null),
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

// ============================================================================
// SUITE 1: Hostile Query Parameter Injection & Boundary Matrix
// ============================================================================
describe('Adversarial M3.2: Hostile Query Parameter Injection & Extreme Sanitization', () => {

  it('1.1: Classic script tag in score parameter (?c=<script>alert(1)</script>) strictly rejected', () => {
    const payloads = [
      '?c=<script>alert(1)</script>',
      '?c=<script src="http://evil.com/xss.js"></script>',
      '?score=<script>alert(document.cookie)</script>&challenger=Attacker'
    ];

    for (const payload of payloads) {
      const result = parseChallengeParams(payload);
      expect(result.hasChallenge).toBe(false);
      expect(result.targetScore).toBeNull();
      expect(result.challengerName).toBeNull();
    }
  });

  it('1.2: Event handler XSS injections in score (?c=100"onerror="alert(1)) strictly rejected', () => {
    const payloads = [
      '?c=100"onerror="alert(1)',
      "?c=100'onerror='alert(1)'",
      '?c=1250><img src=x onerror=alert(1)>',
      '?c=javascript:alert(1)',
      '?c=100;alert(1)'
    ];

    for (const payload of payloads) {
      const result = parseChallengeParams(payload);
      expect(result.hasChallenge).toBe(false);
      expect(result.targetScore).toBeNull();
    }
  });

  it('1.3: Negative, zero, and signed score parameters strictly rejected', () => {
    const payloads = [
      '?c=-50',
      '?c=-0',
      '?c=0',
      '?c=-999999',
      '?c=%2B1250', // Literal encoded plus sign '+1250' rejected by /^\d+$/
      '?c=-1'
    ];

    for (const payload of payloads) {
      const result = parseChallengeParams(payload);
      expect(result.hasChallenge).toBe(false);
      expect(result.targetScore).toBeNull();
    }
  });

  it('1.4: Extreme, overflowing, floating point, and scientific notation numbers strictly rejected', () => {
    const payloads = [
      '?c=99999999999999999', // Massive overflow (17 digits > 9,999,999)
      '?c=10000000',          // Exceeds upper boundary 9,999,999
      '?c=1e10',              // Scientific notation with 'e'
      '?c=1e+308',            // Extreme double limit
      '?c=Infinity',          // Infinity literal
      '?c=-Infinity',
      '?c=NaN',               // NaN literal
      '?c=12.50',             // Floating point
      '?c=1250.0',            // Decimal zero
      '?c=1,250'              // Comma separated
    ];

    for (const payload of payloads) {
      const result = parseChallengeParams(payload);
      expect(result.hasChallenge).toBe(false);
      expect(result.targetScore).toBeNull();
    }
  });

  it('1.5: Strict boundary valid positive integers strictly accepted', () => {
    // Lower bound: 1
    const resMin = parseChallengeParams('?c=1&by=Hero');
    expect(resMin.hasChallenge).toBe(true);
    expect(resMin.targetScore).toBe(1);
    expect(resMin.challengerName).toBe('Hero');

    // Upper bound: 9,999,999
    const resMax = parseChallengeParams('?c=9999999&by=Champion');
    expect(resMax.hasChallenge).toBe(true);
    expect(resMax.targetScore).toBe(9999999);
    expect(resMax.challengerName).toBe('Champion');
  });

  it('1.6: HTML tag injection in challenger name (?by=<img src=x onerror=alert(1)>) stripped to fallback', () => {
    const payload = '?c=1250&by=<img src=x onerror=alert(1)>';
    const result = parseChallengeParams(payload);
    expect(result.hasChallenge).toBe(true);
    expect(result.targetScore).toBe(1250);
    // All tags stripped -> empty -> fallback 'Challenger'
    expect(result.challengerName).toBe('Challenger');
    expect(result.challengerName.includes('<')).toBe(false);
    expect(result.challengerName.includes('>')).toBe(false);
  });

  it('1.7: Script injection mixed with text (?by=<script>alert("pwnd")</script>Sarah) completely strips tags and escapes', () => {
    const payload = '?c=1500&by=<script>alert("pwnd")</script>Sarah';
    const result = parseChallengeParams(payload);
    expect(result.hasChallenge).toBe(true);
    expect(result.targetScore).toBe(1500);
    // Verifies tags are completely stripped and quotes are entity encoded
    expect(result.challengerName).not.toContain('<');
    expect(result.challengerName).not.toContain('>');
    expect(result.challengerName).not.toContain('<script>');
    expect(result.challengerName).not.toContain('</script>');
    expect(result.challengerName).not.toContain('"');
  });

  it('1.8: Dangerous HTML entities in name are encoded (&, <, >, ", \')', () => {
    expect(sanitizeChallengerName('Tom & Bob')).toBe('Tom &amp; Bob');
    expect(sanitizeChallengerName('A "Win"')).toBe('A &quot;Win&quot;');
    expect(sanitizeChallengerName("It's Me")).toBe('It&#39;s Me');

    // Verify raw unescaped quotes or angle brackets never leak
    const rawComplex = `A & B "C" 'D'`;
    const cleanComplex = sanitizeChallengerName(rawComplex);
    expect(cleanComplex).not.toContain('<');
    expect(cleanComplex).not.toContain('>');
    expect(cleanComplex).not.toContain('"');
    expect(cleanComplex).not.toContain("'");

    // Also verify truncation behavior when entities cross the 20-char slice
    const clampedWithEntity = sanitizeChallengerName('Tom & Jerry "Champion"');
    expect(clampedWithEntity.length).toBeLessThanOrEqual(20);
    expect(clampedWithEntity).not.toContain('"');
    expect(clampedWithEntity).not.toContain('<');
  });

  it('1.9: Prototype pollution vectors (?__proto__=admin&constructor[prototype][polluted]=true) cause zero pollution', () => {
    // Before test assertion
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.admin).toBeUndefined();
    expect({}.admin).toBeUndefined();

    const payload = '?__proto__=admin&constructor[prototype][polluted]=true&c=2500&by=CyberGhost';
    const result = parseChallengeParams(payload);

    expect(result.hasChallenge).toBe(true);
    expect(result.targetScore).toBe(2500);
    expect(result.challengerName).toBe('CyberGhost');

    // After test assertion - verify zero pollution
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.admin).toBeUndefined();
    expect({}.admin).toBeUndefined();
  });

  it('1.10: URL encoded unicode, UTF-8, and emoji payloads decoded and preserved safely', () => {
    // "🔥 Cyber 龍"
    const payload = '?c=3200&by=%F0%9F%94%A5%20Cyber%20%E9%BE%8D';
    const result = parseChallengeParams(payload);

    expect(result.hasChallenge).toBe(true);
    expect(result.targetScore).toBe(3200);
    expect(result.challengerName).toBe('🔥 Cyber 龍');
  });

  it('1.11: Malformed percent-encoding (%E0%A4%A) trapped cleanly without throwing uncaught URIError', () => {
    const payload = '?c=3200&by=%E0%A4%A';
    expect(() => {
      const result = parseChallengeParams(payload);
      expect(result).toBeDefined();
    }).not.toThrow();
  });

  it('1.12: ASCII control characters (null bytes \\x00, escapes \\x1B, DEL \\x7F) stripped completely', () => {
    const rawWithControl = 'Alex\x00\x07\x08\x1B\x7FBoss';
    const clean = sanitizeChallengerName(rawWithControl);
    expect(clean).toBe('AlexBoss');
  });

  it('1.13: Massive name payload (> 5000 characters) strictly truncated to 20 characters', () => {
    const massive = 'A'.repeat(5000);
    const clean = sanitizeChallengerName(massive);
    expect(clean.length).toBe(20);
    expect(clean).toBe('A'.repeat(20));
  });

  it('1.14: DOM Injection defense: UIManager.showChallengeBanner uses textContent preventing DOM XSS execution', () => {
    const { doc, elements } = setupMockDocument();
    const origDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });

    try {
      const ui = new UIManager();
      ui.bindDOM();

      const maliciousChallenge = {
        targetScore: 1250,
        challengerName: `<img src=x onerror=alert('xss')>`
      };

      ui.showChallengeBanner(maliciousChallenge);

      const bannerText = elements['challenge-text'].textContent;
      expect(bannerText).toContain('1,250');
      // textContent was populated, innerHTML was untouched
      expect(elements['challenge-text'].innerHTML).toBe('');
      expect(elements['challenge-banner'].classList.contains('hidden')).toBe(false);
    } finally {
      if (origDoc) {
        Object.defineProperty(globalThis, 'document', origDoc);
      } else {
        delete globalThis.document;
      }
    }
  });
});

// ============================================================================
// SUITE 2: Web Share API Adversarial Matrix & Fallback Hierarchy
// ============================================================================
describe('Adversarial M3.2: Web Share API Adversarial Matrix & Fallback Hierarchy', () => {
  let originalNavigatorDesc;
  let originalDocDesc;
  let originalWinDesc;
  let mockDoc;
  let mockElements;

  beforeEach(() => {
    originalDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    originalWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');

    const setup = setupMockDocument();
    mockDoc = setup.doc;
    mockElements = setup.elements;
    Object.defineProperty(globalThis, 'document', { value: mockDoc, configurable: true, writable: true });
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

    if (originalWinDesc) {
      Object.defineProperty(globalThis, 'window', originalWinDesc);
    } else {
      delete globalThis.window;
    }

    vi.restoreAllMocks();
  });

  it('2.1: navigator.share throwing AbortError (DOMException) suppresses silently: ZERO false toasts, ZERO clipboard calls', async () => {
    const mockShare = vi.fn().mockRejectedValue(new DOMException('Share canceled by user', 'AbortError'));
    const mockWriteText = vi.fn().mockResolvedValue();

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: mockShare,
        clipboard: { writeText: mockWriteText }
      },
      configurable: true,
      writable: true
    });

    const shareController = new ShareController();
    const result = await shareController.shareScore({ score: 1250, playerName: 'Alex' });

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.method).toBe('web-share');
    expect(result.cancelled).toBe(true);

    // CRITICAL: Ensure zero fallback clipboard write and zero false toast
    expect(mockWriteText).not.toHaveBeenCalled();
    const toast = mockDoc.getElementById('game-toast');
    expect(toast).toBeNull();
  });

  it('2.2: navigator.share throwing legacy AbortError with code 20 suppresses silently without false toast', async () => {
    const legacyAbortErr = new Error('Abort');
    legacyAbortErr.name = 'AbortError';
    legacyAbortErr.code = 20;

    const mockShare = vi.fn().mockRejectedValue(legacyAbortErr);
    const mockWriteText = vi.fn().mockResolvedValue();

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: mockShare,
        clipboard: { writeText: mockWriteText }
      },
      configurable: true,
      writable: true
    });

    const shareController = new ShareController();
    const result = await shareController.shareScore({ score: 1250 });

    expect(result.cancelled).toBe(true);
    expect(mockWriteText).not.toHaveBeenCalled();
    expect(mockDoc.getElementById('game-toast')).toBeNull();
  });

  it('2.3: navigator.share throwing NotAllowedError seamlessly falls back to clipboard and displays toast', async () => {
    const notAllowedErr = new DOMException('Permission denied', 'NotAllowedError');
    const mockShare = vi.fn().mockRejectedValue(notAllowedErr);
    const mockWriteText = vi.fn().mockResolvedValue();

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: mockShare,
        clipboard: { writeText: mockWriteText }
      },
      configurable: true,
      writable: true
    });

    const shareController = new ShareController();
    const result = await shareController.shareScore({ score: 2500, playerName: 'Sam' });

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.method).toBe('clipboard');
    expect(result.cancelled).toBe(false);

    // Toast must appear
    const toast = mockDoc.getElementById('game-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('📋 Challenge link copied to clipboard!');
  });

  it('2.4: navigator.share throwing generic TypeError / network error falls back to clipboard with toast', async () => {
    const genericErr = new TypeError('Network connection lost during share sheet handoff');
    const mockShare = vi.fn().mockRejectedValue(genericErr);
    const mockWriteText = vi.fn().mockResolvedValue();

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: mockShare,
        clipboard: { writeText: mockWriteText }
      },
      configurable: true,
      writable: true
    });

    const shareController = new ShareController();
    const result = await shareController.shareScore({ score: 800 });

    expect(result.success).toBe(true);
    expect(result.method).toBe('clipboard');
    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(mockDoc.getElementById('game-toast')).not.toBeNull();
  });

  it('2.5: navigator.share undefined (desktop / unsupported) triggers clipboard fallback and toast', async () => {
    const mockWriteText = vi.fn().mockResolvedValue();
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: { writeText: mockWriteText }
      },
      configurable: true,
      writable: true
    });

    const shareController = new ShareController();
    const result = await shareController.shareScore({ score: 999 });

    expect(result.success).toBe(true);
    expect(result.method).toBe('clipboard');
    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(mockDoc.getElementById('game-toast')).not.toBeNull();
  });

  it('2.6: Both navigator.share AND navigator.clipboard reject -> triggers legacy document.execCommand fallback', async () => {
    const mockWriteText = vi.fn().mockRejectedValue(new DOMException('Clipboard permission denied', 'NotAllowedError'));
    mockDoc.execCommand = vi.fn(() => true);

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: { writeText: mockWriteText }
      },
      configurable: true,
      writable: true
    });

    const shareController = new ShareController();
    const result = await shareController.shareScore({ score: 1420 });

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(mockDoc.execCommand).toHaveBeenCalledWith('copy');
    expect(result.success).toBe(true);
    expect(result.method).toBe('clipboard');
    expect(mockDoc.getElementById('game-toast')).not.toBeNull();
  });

  it('2.7: Rapid consecutive share clicks cancel prior timers and maintain singleton toast', async () => {
    vi.useFakeTimers();

    const mockWriteText = vi.fn().mockResolvedValue();
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: { writeText: mockWriteText }
      },
      configurable: true,
      writable: true
    });

    const shareController = new ShareController();

    // Trigger 5 rapid clicks
    for (let i = 0; i < 5; i++) {
      await shareController.shareScore({ score: 100 * (i + 1) });
    }

    const toastShelf = mockDoc.getElementById('toast-container');
    const toastChildren = toastShelf.children.filter(c => c.id === 'game-toast');
    expect(toastChildren.length).toBe(1);

    vi.useRealTimers();
  });

  it('2.8: Toast auto-dismisses: adds fade-out after durationMs and removes node after transition', () => {
    vi.useFakeTimers();

    const shareController = new ShareController();
    const toast = shareController.showToast('Test Toast', 2000);

    expect(toast).not.toBeNull();
    expect(toast.classList.contains('fade-out')).toBe(false);

    // Advance to 1999ms -> still active
    vi.advanceTimersByTime(1999);
    expect(toast.classList.contains('fade-out')).toBe(false);

    // Advance to 2001ms -> fade-out added
    vi.advanceTimersByTime(2);
    expect(toast.classList.contains('fade-out')).toBe(true);

    // Advance past 300ms CSS transition
    vi.advanceTimersByTime(301);
    expect(toast.remove).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('2.9: generateChallengeUrl produces clean URLs across origin, pathname, and offline file: protocols', () => {
    const shareController = new ShareController();

    // Normal web origin
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://antigravity.game',
          pathname: '/app/',
          protocol: 'https:'
        }
      },
      configurable: true,
      writable: true
    });
    const url1 = shareController.generateChallengeUrl(1250, 'Alex');
    expect(url1).toBe('https://antigravity.game/app/?c=1250&by=Alex');

    // file:// protocol fallback
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'null',
          pathname: '/local/path/index.html',
          protocol: 'file:'
        }
      },
      configurable: true,
      writable: true
    });
    const url2 = shareController.generateChallengeUrl(500, 'OfflineUser');
    expect(url2).toBe('/local/path/index.html?c=500&by=OfflineUser');
    expect(url2).not.toContain('file://null');
  });
});

// ============================================================================
// SUITE 3: Preview Server Query Parameter Robustness & Traversal Stress
// ============================================================================
describe('Adversarial M3.2: Preview Server Query Parameter Robustness & HTTP Stress', () => {
  let previewServer;
  let testPort;
  let baseUrl;

  beforeAll(async () => {
    previewServer = createPreviewServer(ROOT);
    await new Promise((resolve) => {
      previewServer.listen(0, '127.0.0.1', () => {
        testPort = previewServer.address().port;
        baseUrl = `http://127.0.0.1:${testPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (previewServer) {
      await new Promise((resolve) => previewServer.close(resolve));
    }
  });

  // Helper for native Node HTTP requests
  function request(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${urlPath}`, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
  }

  it('3.1: Serves root challenge URL (GET /?c=1250&by=Alex) with HTTP 200, text/html, and valid body', async () => {
    const res = await request('/?c=1250&by=Alex');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('AntiGravity');
    expect(res.body).toContain('<canvas');
  });

  it('3.2: Serves explicit index.html challenge URL (GET /index.html?c=9999&by=Hostile%3Cscript%3E) with HTTP 200', async () => {
    const res = await request('/index.html?c=9999&by=Hostile%3Cscript%3E');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body.length).toBeGreaterThan(500);
  });

  it('3.3: Serves static CSS with query parameters (GET /style.css?v=1.2.3&c=100) with HTTP 200 and text/css', async () => {
    const res = await request('/style.css?v=1.2.3&c=100');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.body).toContain('--color-cyan');
  });

  it('3.4: Serves JavaScript modules with query parameters (GET /src/game.js?t=123456) with HTTP 200 and text/javascript', async () => {
    const res = await request('/src/game.js?t=123456');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.body).toContain('GameEngine');
  });

  it('3.5: Serves sw.js with query parameters and preserves no-cache headers', async () => {
    const res = await request('/sw.js?challenge=test');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('3.6: Directory traversal attempt to parent files outside root returns 404 or 403', async () => {
    // Attempting to access parent repository PROJECT.md which is NOT inside mobile_arcade_game
    const res = await request('/PROJECT.md?c=100&by=Attacker');
    expect(res.status).toBe(404);

    // Direct traversal via raw socket to verify directory escape is strictly blocked
    const rawResponse = await new Promise((resolve) => {
      const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
        client.write("GET /../../../PROJECT.md?c=100 HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
      });
      let data = '';
      client.on('data', (chunk) => { data += chunk.toString(); });
      client.on('end', () => resolve(data));
    });

    expect(rawResponse).toMatch(/HTTP\/1\.1 (403|404)/);
  });

  it('3.7: Non-existent file with challenge parameters (GET /missing_screen.html?c=1250) returns 404 Not Found', async () => {
    const res = await request('/missing_screen.html?c=1250');
    expect(res.status).toBe(404);
    expect(res.body).toContain('404 Not Found');
  });

  it('3.8: Concurrency stress: 50 parallel requests with diverse query strings all succeed with HTTP 200', async () => {
    const queries = [
      '/?c=100&by=Alpha',
      '/?c=500&by=Beta',
      '/?c=1250&by=Gamma',
      '/?c=9999999&by=Delta',
      '/?c=1&by=Epsilon',
      '/?c=2000&by=%F0%9F%94%A5',
      '/index.html?c=3000&by=Zeta',
      '/style.css?bust=1',
      '/src/share.js?v=2',
      '/src/ui.js?v=3'
    ];

    const requests = [];
    for (let i = 0; i < 50; i++) {
      const q = queries[i % queries.length];
      requests.push(request(q));
    }

    const responses = await Promise.all(requests);
    expect(responses.length).toBe(50);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });
});
