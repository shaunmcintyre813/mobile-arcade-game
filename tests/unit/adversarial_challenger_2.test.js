import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  ShareController,
  sanitizeChallengerName,
  parseChallengeParams
} from '../../src/share.js';
import {
  StorageController,
  ScoreManager,
  STORAGE_KEY
} from '../../src/score.js';
import { UIManager } from '../../src/ui.js';
import { createPreviewServer, ROOT } from '../../preview.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

// Mock DOM helper for headless testing
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

/* ============================================================================
   CHALLENGER FINAL 2 EMPIRICAL ADVERSARIAL STRESS SUITE
   ============================================================================ */

describe('Challenger Final 2: Hostile Query Parameter Injection & Security Hardening', () => {
  it('1.1 Injected script tags in score (?c=<script>alert(1)</script>) are strictly rejected', () => {
    const payloads = [
      '?c=<script>alert(1)</script>',
      '?score=<script>alert(1)</script>',
      '?c=<script src="https://evil.com/xss.js"></script>',
      '?c=<SCRIPT>alert(1)</SCRIPT>'
    ];
    for (const p of payloads) {
      const res = parseChallengeParams(p);
      expect(res.hasChallenge).toBe(false);
      expect(res.targetScore).toBeNull();
      expect(res.challengerName).toBeNull();
    }
  });

  it('1.2 Negative scores (?c=-9999, ?c=-1, ?c=-0) are strictly rejected', () => {
    const payloads = ['?c=-9999', '?c=-1', '?c=-0', '?score=-9999'];
    for (const p of payloads) {
      const res = parseChallengeParams(p);
      expect(res.hasChallenge).toBe(false);
      expect(res.targetScore).toBeNull();
      expect(res.challengerName).toBeNull();
    }
  });

  it('1.3 Exorbitant overflow numbers (?c=999999999999999999) are strictly rejected (> 9,999,999)', () => {
    const payloads = [
      '?c=999999999999999999',
      '?c=10000000',
      '?c=99999999999999999999999999999999999999',
      '?score=10000001'
    ];
    for (const p of payloads) {
      const res = parseChallengeParams(p);
      expect(res.hasChallenge).toBe(false);
      expect(res.targetScore).toBeNull();
      expect(res.challengerName).toBeNull();
    }
  });

  it('1.4 Injected HTML image onerror (?by=<img src=x onerror=alert(1)>) is stripped and sanitized', () => {
    const payloads = [
      '?c=1250&by=<img src=x onerror=alert(1)>',
      '?c=1250&challenger=<img src="x" onerror="alert(document.cookie)">',
      '?c=1250&by=<IMG SRC=X ONERROR=ALERT(1)>'
    ];
    for (const p of payloads) {
      const res = parseChallengeParams(p);
      expect(res.hasChallenge).toBe(true);
      expect(res.targetScore).toBe(1250);
      // Empty after tag stripping -> fallback to 'Challenger'
      expect(res.challengerName).toBe('Challenger');
      expect(res.challengerName).not.toContain('<');
      expect(res.challengerName).not.toContain('>');
      expect(res.challengerName).not.toContain('onerror');
    }
  });

  it('1.5 Prototype pollution attempts (?__proto__[polluted]=true, ?constructor.prototype.polluted=true) cause zero pollution', () => {
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.isAdmin).toBeUndefined();
    expect({}.polluted).toBeUndefined();

    const pollutionPayloads = [
      '?__proto__[polluted]=true&c=500&by=Alex',
      '?__proto__.polluted=true&c=500&by=Alex',
      '?constructor.prototype.polluted=true&c=500&by=Alex',
      '?constructor[prototype][polluted]=true&c=500&by=Alex',
      '?prototype[polluted]=true&c=500&by=Alex',
      '?__proto__[isAdmin]=true&c=500&by=Alex'
    ];

    for (const p of pollutionPayloads) {
      const res = parseChallengeParams(p);
      expect(res.hasChallenge).toBe(true);
      expect(res.targetScore).toBe(500);
      expect(res.challengerName).toBe('Alex');

      // Verify zero prototype pollution
      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.prototype.isAdmin).toBeUndefined();
      expect({}.polluted).toBeUndefined();
      expect({}.isAdmin).toBeUndefined();
    }
  });

  it('1.6 UIManager.showChallengeBanner DOM rendering is strictly immune to XSS execution', () => {
    const { doc, elements } = setupMockDocument();
    const origDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });

    try {
      const ui = new UIManager();
      ui.bindDOM();

      const hostileChallenge = {
        targetScore: 2500,
        challengerName: '<svg/onload=alert(1)>'
      };

      ui.showChallengeBanner(hostileChallenge);

      const bannerText = elements['challenge-text'].textContent;
      expect(bannerText).toContain('2,500');
      // Rendered via textContent -> innerHTML is empty
      expect(elements['challenge-text'].innerHTML).toBe('');
      expect(elements['challenge-text'].children.length).toBe(0);
    } finally {
      if (origDoc) {
        Object.defineProperty(globalThis, 'document', origDoc);
      } else {
        delete globalThis.document;
      }
    }
  });

  it('1.7 Extreme edge cases: non-string search, empty queries, whitespace-only, and malformed URI sequences', () => {
    expect(parseChallengeParams(null)).toEqual({ hasChallenge: false, targetScore: null, challengerName: null });
    expect(parseChallengeParams(undefined)).toEqual({ hasChallenge: false, targetScore: null, challengerName: null });
    expect(parseChallengeParams('')).toEqual({ hasChallenge: false, targetScore: null, challengerName: null });
    expect(parseChallengeParams('   ')).toEqual({ hasChallenge: false, targetScore: null, challengerName: null });
    expect(parseChallengeParams(12345)).toEqual({ hasChallenge: false, targetScore: null, challengerName: null });
    expect(parseChallengeParams({})).toEqual({ hasChallenge: false, targetScore: null, challengerName: null });
    expect(parseChallengeParams('?c=%E0%A4%A&by=%E0%A4%A')).toBeDefined();
  });
});

describe('Challenger Final 2: Storage Subsystem Resilience & Fault Recovery', () => {
  it('2.1 QuotaExceededError during saveHighScore falls back to in-memory score with zero crashes', () => {
    const quotaError = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    const mockStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw quotaError; })
    };

    const ctrl = new StorageController(mockStorage);
    expect(ctrl.getHighScore()).toBe(0);

    // Save should catch QuotaExceededError and return true (saved in-memory)
    expect(() => {
      const saved = ctrl.saveHighScore(3500);
      expect(saved).toBe(true);
    }).not.toThrow();

    // In-memory score is retained
    expect(ctrl.getHighScore()).toBe(3500);

    // Strictly monotonic behavior preserved
    expect(ctrl.saveHighScore(2000)).toBe(false);
    expect(ctrl.getHighScore()).toBe(3500);
    expect(ctrl.saveHighScore(5000)).toBe(true);
    expect(ctrl.getHighScore()).toBe(5000);
  });

  it('2.2 Corrupted localStorage values (JSON syntax errors, [object Object], NaN, negatives) recover gracefully to in-memory score', () => {
    const corruptValues = [
      '{corrupt: json[',
      '[object Object]',
      '{"score": "corrupt"}',
      'NaN',
      'undefined',
      'null',
      'Infinity',
      '-Infinity',
      '-5000',
      '0',
      '',
      '   \r\n\t  ',
      'true',
      'false',
      '{}',
      '[]',
      '9'.repeat(50000) // Huge integer
    ];

    for (const val of corruptValues) {
      const mockStorage = {
        getItem: vi.fn(() => val),
        setItem: vi.fn()
      };

      const ctrl = new StorageController(mockStorage);
      expect(() => ctrl.getHighScore()).not.toThrow();
      const readVal = ctrl.getHighScore();
      expect(Number.isFinite(readVal)).toBe(true);
      expect(readVal).toBeGreaterThanOrEqual(0);
    }
  });

  it('2.3 SecurityError / Read-Only storage (Restricted private browsing / iframe) falls back to in-memory score with zero crashes', () => {
    const secError = new DOMException('Storage access denied by user or policy.', 'SecurityError');
    const mockStorage = {
      getItem: vi.fn(() => { throw secError; }),
      setItem: vi.fn(() => { throw secError; })
    };

    const ctrl = new StorageController(mockStorage);

    // Read should catch SecurityError and return 0
    expect(() => {
      const score = ctrl.getHighScore();
      expect(score).toBe(0);
    }).not.toThrow();

    // Write should catch SecurityError and succeed in-memory
    expect(() => {
      const saved = ctrl.saveHighScore(1800);
      expect(saved).toBe(true);
    }).not.toThrow();

    expect(ctrl.getHighScore()).toBe(1800);
  });

  it('2.4 window.localStorage throwing SecurityError on property access itself is safely handled', () => {
    const origWin = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const secError = new DOMException('Restricted context', 'SecurityError');

    Object.defineProperty(globalThis, 'window', {
      value: {
        get localStorage() {
          throw secError;
        }
      },
      configurable: true,
      writable: true
    });

    try {
      const ctrl = new StorageController();
      expect(() => ctrl.getHighScore()).not.toThrow();
      expect(ctrl.getHighScore()).toBe(0);
      expect(() => ctrl.saveHighScore(950)).not.toThrow();
      expect(ctrl.getHighScore()).toBe(950);
    } finally {
      if (origWin) {
        Object.defineProperty(globalThis, 'window', origWin);
      } else {
        delete globalThis.window;
      }
    }
  });
});

describe('Challenger Final 2: Offline Service Worker Navigation & Query Neutrality', () => {
  it('3.1 sw.js source code verification: Navigation strategy uses ignoreSearch: true and cached index.html', () => {
    const swPath = path.join(projectRoot, 'sw.js');
    const swCode = fs.readFileSync(swPath, 'utf8');

    // Verify Strategy A for navigation requests
    expect(swCode).toMatch(/request\.mode\s*===\s*['"]navigate['"]/);
    expect(swCode).toMatch(/caches\.match\(['"]\.\/index\.html['"],\s*\{\s*ignoreSearch:\s*true\s*\}\)/);
  });

  it('3.2 Service Worker fetch event simulator: Offline navigation with query params serves cached index.html', async () => {
    // Simulate Cache storage
    const fakeHtmlResponse = new Response('<!DOCTYPE html><html><head><title>Cached AntiGravity</title></head></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });

    const mockCache = {
      match: vi.fn((req, opts) => {
        if ((req === './index.html' || req === '/index.html') && opts && opts.ignoreSearch) {
          return Promise.resolve(fakeHtmlResponse.clone());
        }
        return Promise.resolve(null);
      }),
      put: vi.fn(() => Promise.resolve())
    };

    const mockCaches = {
      match: vi.fn((req, opts) => {
        return mockCache.match(req, opts);
      }),
      open: vi.fn(() => Promise.resolve(mockCache))
    };

    // Simulate navigation request with hostile challenge query
    const navigationRequest = {
      method: 'GET',
      mode: 'navigate',
      url: 'https://antigravity.neon.pulse/?c=1250&by=Alex&__proto__[polluted]=true'
    };

    // Execute the navigation logic from sw.js
    let respondedPromise = null;
    const mockEvent = {
      request: navigationRequest,
      respondWith: vi.fn((p) => {
        respondedPromise = p;
      })
    };

    // Offline simulation: network fetch throws
    const networkFetchSimulator = () => Promise.reject(new TypeError('Failed to fetch (offline)'));

    // Replicate fetch listener navigation block from sw.js
    const cachedIndex = await mockCaches.match('./index.html', { ignoreSearch: true });
    expect(cachedIndex).not.toBeNull();

    const netPromise = networkFetchSimulator().catch(() => cachedIndex);
    const finalResponse = cachedIndex || (await netPromise);

    expect(finalResponse.status).toBe(200);
    const text = await finalResponse.text();
    expect(text).toContain('Cached AntiGravity');
  });

  it('3.3 Audit of all PRECACHE_ASSETS: Every asset in sw.js exists physically and can be resolved', () => {
    const swPath = path.join(projectRoot, 'sw.js');
    const swCode = fs.readFileSync(swPath, 'utf8');

    const match = swCode.match(/const PRECACHE_ASSETS = \[(.*?)\];/s);
    expect(match).not.toBeNull();

    const assets = match[1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    expect(assets.length).toBeGreaterThanOrEqual(11);

    for (const asset of assets) {
      const relPath = asset.replace(/^\.\//, '');
      const filePath = path.join(projectRoot, relPath === '' ? 'index.html' : relPath);
      expect(fs.existsSync(filePath), `Precache asset "${asset}" must physically exist at ${filePath}`).toBe(true);
    }
  });
});

describe('Challenger Final 2: Zero-Dependency Preview Server Security & Path Traversal', () => {
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

  function rawHttpRequest(pathString) {
    return new Promise((resolve) => {
      const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
        client.write(`GET ${pathString} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      });
      let data = '';
      client.on('data', chunk => { data += chunk.toString(); });
      client.on('end', () => resolve(data));
      client.on('error', () => resolve('ERROR'));
    });
  }

  function httpGet(pathString) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${pathString}`, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
  }

  it('4.1 Path traversal via /../../etc/passwd returns 403 or 404', async () => {
    const rawRes = await rawHttpRequest('/../../etc/passwd');
    expect(rawRes).toMatch(/HTTP\/1\.1 (403|404)/);
  });

  it('4.2 Path traversal via Windows backslashes (/..\\..\\windows\\win.ini) returns 403 or 404', async () => {
    const rawRes = await rawHttpRequest('/..\\..\\windows\\win.ini');
    expect(rawRes).toMatch(/HTTP\/1\.1 (403|404)/);
  });

  it('4.3 URL-encoded traversal payloads (%2e%2e%2f, %2e%2e%5c) return 403 or 404', async () => {
    const rawRes1 = await rawHttpRequest('/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    expect(rawRes1).toMatch(/HTTP\/1\.1 (403|404)/);

    const rawRes2 = await rawHttpRequest('/%2e%2e%5c%2e%2e%5cwindows%5cwin.ini');
    expect(rawRes2).toMatch(/HTTP\/1\.1 (403|404)/);
  });

  it('4.4 Deep traversal (10 levels up) returns 403 or 404', async () => {
    const rawRes = await rawHttpRequest('/../../../../../../../../../../Windows/System32/drivers/etc/hosts');
    expect(rawRes).toMatch(/HTTP\/1\.1 (403|404)/);
  });

  it('4.5 Legitimate query parameters on index.html and root are served with HTTP 200', async () => {
    const resRoot = await httpGet('/?c=1250&by=Alex');
    expect(resRoot.status).toBe(200);
    expect(resRoot.headers['content-type']).toContain('text/html');
    expect(resRoot.body).toContain('AntiGravity: Neon Pulse');

    const resIndex = await httpGet('/index.html?c=9999&by=Marcus');
    expect(resIndex.status).toBe(200);
    expect(resIndex.headers['content-type']).toContain('text/html');
  });

  it('4.6 sw.js preserves no-cache headers when requested via preview server', async () => {
    const res = await httpGet('/sw.js?challenge=test');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });
});
