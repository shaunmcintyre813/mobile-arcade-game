import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DisplayManager } from '../../src/display.js';
import { TouchController } from '../../src/touch.js';
import { SoundEngine } from '../../src/audio.js';
import { createPreviewServer } from '../../preview.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

// Helper to create mock canvas element
function createMockCanvas(width = 412, height = 915) {
  const contextMock = {
    setTransform: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn()
  };

  return {
    width: 0,
    height: 0,
    clientWidth: width,
    clientHeight: height,
    style: {
      width: '',
      height: ''
    },
    getContext: vi.fn().mockReturnValue(contextMock),
    getBoundingClientRect: vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width: width,
      height: height
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
}

describe('Adversarial Stress Suite: DisplayManager Viewport & Math Hardening', () => {
  beforeEach(() => {
    global.window = {
      innerWidth: 412,
      innerHeight: 915,
      devicePixelRatio: 3.5,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
  });

  describe('1. Extreme Aspect Ratios Stress Test', () => {
    const aspectScenarios = [
      { name: 'Samsung Galaxy S25 Ultra (20:9)', w: 412, h: 915, expScale: 1.03, expHv: 888.35 },
      { name: 'Sony Xperia 1 (21:9)', w: 384, h: 896, expScale: 0.96, expHv: 933.33 },
      { name: 'iPhone 15 Pro (19.5:9)', w: 390, h: 844, expScale: 0.975, expHv: 865.64 },
      { name: 'Classic Mobile 16:9', w: 360, h: 640, expScale: 0.9, expHv: 711.11 },
      { name: 'Square Foldable Outer (1:1)', w: 500, h: 500, expScale: 1.25, expHv: 400.0 },
      { name: 'Desktop Landscape 16:9', w: 1920, h: 1080, expScale: 4.8, expHv: 225.0 },
      { name: 'Ultrawide Desktop 21:9', w: 2560, h: 1080, expScale: 6.4, expHv: 168.75 },
      { name: 'Ultra-tall Extreme (1:20)', w: 100, h: 2000, expScale: 0.25, expHv: 8000.0 },
      { name: 'Ultra-wide Extreme (20:1)', w: 2000, h: 100, expScale: 5.0, expHv: 20.0 },
      { name: 'Micro Viewport (10x10)', w: 10, h: 10, expScale: 0.025, expHv: 400.0 }
    ];

    for (const s of aspectScenarios) {
      it(`evaluates ${s.name} [${s.w}x${s.h}] without distortion, NaN, or Infinity`, () => {
        global.window.innerWidth = s.w;
        global.window.innerHeight = s.h;

        const canvas = createMockCanvas(s.w, s.h);
        const dm = new DisplayManager(canvas, 400);
        const bounds = dm.getVirtualBounds();

        expect(bounds.width).toBe(400);
        expect(bounds.scale).toBeCloseTo(s.expScale, 4);
        expect(bounds.height).toBeCloseTo(s.expHv, 2);

        expect(Number.isFinite(bounds.scale)).toBe(true);
        expect(Number.isFinite(bounds.height)).toBe(true);
        expect(Number.isNaN(bounds.scale)).toBe(false);
        expect(Number.isNaN(bounds.height)).toBe(false);
        expect(bounds.scale).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
      });
    }
  });

  describe('2. Extreme Device Pixel Ratios (DPR) Clamping', () => {
    it('clamps DPR to minimum 1.0 when rawDpr is sub-1 (e.g. 0.5, 0.25)', () => {
      for (const dpr of [0.1, 0.25, 0.5, 0.75]) {
        global.window.devicePixelRatio = dpr;
        const canvas = createMockCanvas();
        const dm = new DisplayManager(canvas, 400);
        expect(dm.dpr).toBe(1.0);
        expect(canvas.width).toBe(412);
        expect(canvas.height).toBe(915);
      }
    });

    it('clamps DPR to maximum 3.0 when rawDpr exceeds 3.0 (e.g. 3.5, 4.0, 5.0, 10.0)', () => {
      for (const dpr of [3.5, 4.0, 5.0, 10.0]) {
        global.window.devicePixelRatio = dpr;
        const canvas = createMockCanvas();
        const dm = new DisplayManager(canvas, 400);
        expect(dm.dpr).toBe(3.0);
        expect(canvas.width).toBe(412 * 3);
        expect(canvas.height).toBe(915 * 3);
      }
    });

    it('safely handles non-positive DPR (0, -1, -5) by clamping to 1.0', () => {
      for (const dpr of [0, -1, -5]) {
        global.window.devicePixelRatio = dpr;
        const canvas = createMockCanvas();
        const dm = new DisplayManager(canvas, 400);
        expect(dm.dpr).toBe(1.0);
      }
    });
  });

  describe('3. Zero and Negative Dimensions Fallback Stability', () => {
    it('falls back to safe default dimensions (412x915) when window dimensions are 0', () => {
      global.window.innerWidth = 0;
      global.window.innerHeight = 0;

      const canvas = createMockCanvas(0, 0);
      const dm = new DisplayManager(canvas, 400);
      const bounds = dm.getVirtualBounds();

      expect(bounds.width).toBe(400);
      expect(bounds.scale).toBeCloseTo(1.03, 2);
      expect(bounds.height).toBeCloseTo(888.35, 1);
      expect(Number.isFinite(bounds.scale)).toBe(true);
      expect(Number.isFinite(bounds.height)).toBe(true);
    });

    it('screenToVirtual never produces NaN or divides by zero even if scale is non-positive', () => {
      const canvas = createMockCanvas();
      const dm = new DisplayManager(canvas, 400);

      // Force scale to zero / negative to stress-test effectiveScale fallback
      dm.scale = 0;
      const resZero = dm.screenToVirtual(200, 300);
      expect(resZero).toEqual({ x: 200, y: 300 });
      expect(Number.isFinite(resZero.x)).toBe(true);
      expect(Number.isFinite(resZero.y)).toBe(true);

      dm.scale = -0.5;
      const resNeg = dm.screenToVirtual(200, 300);
      expect(resNeg).toEqual({ x: 200, y: 300 });
      expect(Number.isFinite(resNeg.x)).toBe(true);
      expect(Number.isFinite(resNeg.y)).toBe(true);
    });
  });

  describe('4. Bijectivity & Invertibility of screenToVirtual', () => {
    it('screenToVirtual is strictly invertible across 10,000 coordinate pairs without NaN or Infinity', () => {
      global.window.innerWidth = 412;
      global.window.innerHeight = 915;
      const canvas = createMockCanvas();
      const dm = new DisplayManager(canvas, 400);
      const scale = dm.scale;

      expect(scale).toBeCloseTo(1.03, 4);

      // Inversion function: virtualToScreen(vx, vy) = (vx * scale, vy * scale)
      const virtualToScreen = (vx, vy) => ({
        screenX: vx * scale,
        screenY: vy * scale
      });

      // Sample a dense grid of points across screen space [-500, 1500]
      const step = 20;
      let count = 0;

      for (let sx = -500; sx <= 1500; sx += step) {
        for (let sy = -500; sy <= 1500; sy += step) {
          const v = dm.screenToVirtual(sx, sy);

          // Assert no NaN or Infinity
          expect(Number.isFinite(v.x)).toBe(true);
          expect(Number.isFinite(v.y)).toBe(true);
          expect(Number.isNaN(v.x)).toBe(false);
          expect(Number.isNaN(v.y)).toBe(false);

          // Invert back to screen
          const reconstructed = virtualToScreen(v.x, v.y);
          expect(reconstructed.screenX).toBeCloseTo(sx, 9);
          expect(reconstructed.screenY).toBeCloseTo(sy, 9);

          count++;
        }
      }

      expect(count).toBeGreaterThanOrEqual(10000);
    });
  });
});

describe('Adversarial Stress Suite: TouchController Multi-Touch & Gesture Isolation', () => {
  let listeners = {};
  let mockElement = null;

  beforeEach(() => {
    listeners = {};
    mockElement = {
      addEventListener: vi.fn((type, fn) => {
        listeners[type] = fn;
      }),
      removeEventListener: vi.fn(),
      clientWidth: 412,
      clientHeight: 915,
      getBoundingClientRect: vi.fn().mockReturnValue({
        left: 0,
        top: 0,
        right: 412,
        bottom: 915,
        width: 412,
        height: 915
      })
    };
  });

  it('rejects secondary touches during multi-touch bursts (Single-touch lock)', () => {
    const onTap = vi.fn();
    const onDrag = vi.fn();
    const tc = new TouchController(mockElement, null, { onTap, onDrag });

    // Touch 1 starts (primary finger, id: 101)
    listeners['touchstart']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 101, clientX: 100, clientY: 200 }]
    });

    expect(tc.touchActive).toBe(true);
    expect(tc.touchId).toBe(101);
    expect(onTap).toHaveBeenCalledTimes(1);

    // Rapid burst: Touch 2 (id: 102) and Touch 3 (id: 103) start while Touch 1 is active
    listeners['touchstart']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [
        { identifier: 102, clientX: 250, clientY: 300 },
        { identifier: 103, clientX: 300, clientY: 400 }
      ]
    });

    // Must still be locked to primary touch 101
    expect(tc.touchActive).toBe(true);
    expect(tc.touchId).toBe(101);
    expect(onTap).toHaveBeenCalledTimes(1); // onTap not spammed

    // Move event containing touches 102 and 103, but not 101
    listeners['touchmove']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [
        { identifier: 102, clientX: 260, clientY: 310 },
        { identifier: 103, clientX: 310, clientY: 410 }
      ]
    });
    // Secondary finger movement ignored
    expect(onDrag).not.toHaveBeenCalled();

    // Move event containing touch 101
    listeners['touchmove']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 101, clientX: 120, clientY: 210 }]
    });
    expect(onDrag).toHaveBeenCalledTimes(1);

    // Touch 2 ends (secondary finger lifts)
    listeners['touchend']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 102, clientX: 260, clientY: 310 }]
    });
    // Primary touch must still be active!
    expect(tc.touchActive).toBe(true);
    expect(tc.touchId).toBe(101);

    // Finally primary touch 101 ends
    listeners['touchend']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 101, clientX: 120, clientY: 210 }]
    });
    expect(tc.touchActive).toBe(false);
    expect(tc.touchId).toBe(null);

    tc.destroy();
  });

  it('touchcancel completely resets active touch state and fires onRelease', () => {
    const onRelease = vi.fn();
    const tc = new TouchController(mockElement, null, { onRelease });

    listeners['touchstart']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 99, clientX: 200, clientY: 400 }]
    });

    expect(tc.touchActive).toBe(true);

    // Fire touchcancel (e.g. incoming call, notification tray pull down)
    const cancelEvt = {
      cancelable: true,
      preventDefault: vi.fn()
    };
    listeners['touchcancel'](cancelEvt);

    expect(cancelEvt.preventDefault).toHaveBeenCalled();
    expect(tc.touchActive).toBe(false);
    expect(tc.touchId).toBe(null);
    expect(onRelease).toHaveBeenCalledTimes(1);

    const input = tc.consumeInput();
    expect(input.active).toBe(false);
    expect(input.dragX).toBe(0);
    expect(input.dragY).toBe(0);

    tc.destroy();
  });

  it('tracks out-of-bounds drags cleanly without clamping or throwing', () => {
    const onDrag = vi.fn();
    const tc = new TouchController(mockElement, null, { onDrag });

    listeners['touchstart']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }]
    });

    // Drag way off-screen left and top
    listeners['touchmove']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 1, clientX: -800, clientY: -1200 }]
    });

    expect(onDrag).toHaveBeenCalledTimes(1);
    const [coords, delta] = onDrag.mock.calls[0];
    expect(coords.x).toBeLessThan(0);
    expect(coords.y).toBeLessThan(0);
    expect(delta.x).toBeLessThan(0);
    expect(delta.y).toBeLessThan(0);
    expect(Number.isFinite(coords.x)).toBe(true);
    expect(Number.isFinite(coords.y)).toBe(true);

    tc.destroy();
  });

  it('consistently calls preventDefault on cancelable events, and skips on non-cancelable', () => {
    const tc = new TouchController(mockElement);
    const eventTypes = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];

    for (const type of eventTypes) {
      // 1. When event.cancelable is true -> preventDefault MUST be called
      const cancelableEvt = {
        cancelable: true,
        preventDefault: vi.fn(),
        changedTouches: [{ identifier: 77, clientX: 100, clientY: 100 }]
      };
      listeners[type](cancelableEvt);
      expect(cancelableEvt.preventDefault).toHaveBeenCalled();

      // Reset touch state between tests
      tc.clearTouch();

      // 2. When event.cancelable is false -> preventDefault MUST NOT be called (would cause console error)
      const nonCancelableEvt = {
        cancelable: false,
        preventDefault: vi.fn(),
        changedTouches: [{ identifier: 78, clientX: 100, clientY: 100 }]
      };
      listeners[type](nonCancelableEvt);
      expect(nonCancelableEvt.preventDefault).not.toHaveBeenCalled();

      tc.clearTouch();
    }

    tc.destroy();
  });
});

describe('Adversarial Stress Suite: Preview Server & Service Worker Query Neutrality', () => {
  let serverInstance = null;
  let testPort = 0;

  beforeEach(async () => {
    serverInstance = createPreviewServer(projectRoot);
    await new Promise((resolve) => {
      serverInstance.listen(0, '127.0.0.1', () => {
        testPort = serverInstance.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
  });

  it('preview.js serves index.html on root request with arbitrary query parameters', async () => {
    const queryUrls = [
      `http://127.0.0.1:${testPort}/?c=1250&by=Alex`,
      `http://127.0.0.1:${testPort}/?c=999999&by=CyberPro%2099&utm_source=sms`,
      `http://127.0.0.1:${testPort}/index.html?c=450&by=Guest`
    ];

    for (const url of queryUrls) {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const text = await res.text();
      expect(text).toContain('AntiGravity: Neon Pulse');
    }
  });

  it('preview.js strips query params and serves static assets correctly', async () => {
    const assetQueries = [
      { url: `http://127.0.0.1:${testPort}/style.css?v=1.0.0`, type: 'text/css' },
      { url: `http://127.0.0.1:${testPort}/manifest.webmanifest?build=2026`, type: 'application/manifest+json' },
      { url: `http://127.0.0.1:${testPort}/src/display.js?hash=abc`, type: 'text/javascript' },
      { url: `http://127.0.0.1:${testPort}/icons/icon.svg?color=neon`, type: 'image/svg+xml' }
    ];

    for (const item of assetQueries) {
      const res = await fetch(item.url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(item.type);
    }
  });

  it('all 11 precache assets in sw.js physically exist and respond with HTTP 200 on preview server', async () => {
    const swContent = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
    const match = swContent.match(/const PRECACHE_ASSETS = \[(.*?)\];/s);
    expect(match).toBeDefined();

    const rawAssets = match[1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    expect(rawAssets.length).toBe(11);

    for (const asset of rawAssets) {
      const fetchUrl = `http://127.0.0.1:${testPort}/${asset.replace(/^\.\//, '')}`;
      const res = await fetch(fetchUrl);
      expect(res.status, `Asset ${asset} (${fetchUrl}) must return 200`).toBe(200);
    }
  });

  it('preview.js prevents escaping root directory when accessing parent files', async () => {
    // Attempting to access file that only exists outside ROOT (like ../package.json or ../PROJECT.md)
    const res = await fetch(`http://127.0.0.1:${testPort}/PROJECT.md`);
    // PROJECT.md is in parent AntiGravity/, NOT inside mobile_arcade_game/
    expect(res.status).toBe(404);

    // Test raw socket path without client-side normalization
    const { default: net } = await import('net');
    const rawResponse = await new Promise((resolve) => {
      const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
        client.write("GET /../../../PROJECT.md HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
      });
      let data = '';
      client.on('data', (chunk) => {
        data += chunk.toString();
      });
      client.on('end', () => {
        resolve(data);
      });
    });

    // Should return 404 Not Found (since WHATWG URL normalizes to /PROJECT.md which is not in ROOT) or 403 Forbidden
    expect(rawResponse).toMatch(/HTTP\/1\.1 (403|404)/);
  });
});
