import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

import { DisplayManager } from '../../src/display.js';
import { TouchController } from '../../src/touch.js';
import { SoundEngine } from '../../src/audio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

// Helper to create mock canvas element
function createMockCanvas() {
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
    clientWidth: 412,
    clientHeight: 915,
    style: {
      width: '',
      height: ''
    },
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

describe('Milestone 1: DisplayManager Viewport & Projection Math', () => {
  beforeEach(() => {
    // Setup global window environment mock
    global.window = {
      innerWidth: 412,
      innerHeight: 915,
      devicePixelRatio: 3.5,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
  });

  it('correctly calculates Galaxy S25 Ultra projection math (412x915 -> S=1.03, Hv≈888)', () => {
    const canvas = createMockCanvas();
    const dm = new DisplayManager(canvas, 400);

    const bounds = dm.getVirtualBounds();

    // Virtual width fixed at 400
    expect(bounds.width).toBe(400);

    // Scale factor: 412 / 400 = 1.03
    expect(bounds.scale).toBeCloseTo(1.03, 4);

    // Virtual height: 915 / 1.03 = 888.3495...
    expect(bounds.height).toBeCloseTo(888.35, 1);
    expect(Math.round(bounds.height)).toBe(888);
  });

  it('clamps devicePixelRatio to maximum 3.0 on high-DPI displays (e.g. DPR 3.5 -> 3.0)', () => {
    global.window.devicePixelRatio = 3.5;
    const canvas = createMockCanvas();
    const dm = new DisplayManager(canvas, 400);

    expect(dm.dpr).toBe(3.0);
    // Physical buffer scaled by clamped DPR: 412 * 3.0 = 1236, 915 * 3.0 = 2745
    expect(canvas.width).toBe(1236);
    expect(canvas.height).toBe(2745);
  });

  it('preserves native DPR if <= 3.0 (e.g. DPR 2.0 -> 2.0)', () => {
    global.window.devicePixelRatio = 2.0;
    const canvas = createMockCanvas();
    const dm = new DisplayManager(canvas, 400);

    expect(dm.dpr).toBe(2.0);
    expect(canvas.width).toBe(412 * 2);
    expect(canvas.height).toBe(915 * 2);
  });

  it('correctly scales iPhone 15 Pro viewport (390x844 -> S=0.975, Hv≈865.64)', () => {
    global.window.innerWidth = 390;
    global.window.innerHeight = 844;
    global.window.devicePixelRatio = 3.0;

    const canvas = createMockCanvas();
    const dm = new DisplayManager(canvas, 400);
    const bounds = dm.getVirtualBounds();

    expect(bounds.scale).toBeCloseTo(0.975, 4);
    expect(bounds.height).toBeCloseTo(865.64, 1);
  });

  it('correctly scales compact 16:9 viewport (360x640 -> S=0.9, Hv≈711.11)', () => {
    global.window.innerWidth = 360;
    global.window.innerHeight = 640;
    global.window.devicePixelRatio = 2.0;

    const canvas = createMockCanvas();
    const dm = new DisplayManager(canvas, 400);
    const bounds = dm.getVirtualBounds();

    expect(bounds.scale).toBeCloseTo(0.9, 4);
    expect(bounds.height).toBeCloseTo(711.11, 1);
  });

  it('screenToVirtual converts screen pixels to virtual game units accurately', () => {
    global.window.innerWidth = 412;
    global.window.innerHeight = 915;
    const canvas = createMockCanvas();
    const dm = new DisplayManager(canvas, 400);

    // Screen center: x=206, y=457.5
    // Virtual coordinates: 206 / 1.03 = 200, 457.5 / 1.03 = 444.17
    const vCoords = dm.screenToVirtual(206, 457.5);
    expect(vCoords.x).toBeCloseTo(200, 2);
    expect(vCoords.y).toBeCloseTo(444.17, 1);
  });

  it('notifies resize listeners when resize() is invoked', () => {
    const canvas = createMockCanvas();
    const dm = new DisplayManager(canvas, 400);

    const listener = vi.fn();
    dm.onResize(listener);

    dm.resize();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ width: 400 }));

    dm.offResize(listener);
    dm.resize();
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });
});

describe('Milestone 1: TouchController Non-Passive Prevention & Virtual Mapping', () => {
  it('registers touchstart, touchmove, touchend, touchcancel with { passive: false }', () => {
    const registered = [];
    const mockElement = {
      addEventListener: vi.fn((type, fn, opts) => {
        registered.push({ type, fn, opts });
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 412, height: 915 })
    };

    const tc = new TouchController(mockElement);

    const touchEventTypes = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
    for (const eventType of touchEventTypes) {
      const match = registered.find(r => r.type === eventType);
      expect(match).toBeDefined();
      expect(match.opts).toEqual({ passive: false });
    }
    tc.destroy();
  });

  it('calls preventDefault on touch events to suppress pull-to-refresh & zoom', () => {
    const registered = {};
    const mockElement = {
      addEventListener: vi.fn((type, fn) => {
        registered[type] = fn;
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 412, height: 915 })
    };

    const tc = new TouchController(mockElement);

    // Test touchstart preventDefault
    const startEvent = {
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 1, clientX: 206, clientY: 457 }]
    };
    registered['touchstart'](startEvent);
    expect(startEvent.preventDefault).toHaveBeenCalled();

    // Test touchmove preventDefault
    const moveEvent = {
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 1, clientX: 226, clientY: 457 }]
    };
    registered['touchmove'](moveEvent);
    expect(moveEvent.preventDefault).toHaveBeenCalled();

    // Test touchend preventDefault
    const endEvent = {
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 1, clientX: 226, clientY: 457 }]
    };
    registered['touchend'](endEvent);
    expect(endEvent.preventDefault).toHaveBeenCalled();

    tc.destroy();
  });

  it('triggers onTap callback with mapped virtual coordinates on touch contact', () => {
    let touchHandler = null;
    const mockElement = {
      addEventListener: vi.fn((type, fn) => {
        if (type === 'touchstart') touchHandler = fn;
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 400, height: 800 })
    };

    const onTap = vi.fn();
    const tc = new TouchController(mockElement, null, { onTap });

    touchHandler({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 0, clientX: 200, clientY: 400 }]
    });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ x: 200, y: 400 });
    tc.destroy();
  });

  it('triggers onDrag with virtual coordinates and deltaPos during touch movements', () => {
    const listeners = {};
    const mockElement = {
      addEventListener: vi.fn((type, fn) => {
        listeners[type] = fn;
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 400, height: 800 })
    };

    const onDrag = vi.fn();
    const tc = new TouchController(mockElement, null, { onDrag });

    // Touch start at (100, 300)
    listeners['touchstart']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 5, clientX: 100, clientY: 300 }]
    });

    // Touch move to (150, 310) -> deltaX = +50, deltaY = +10
    listeners['touchmove']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 5, clientX: 150, clientY: 310 }]
    });

    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledWith(
      { x: 150, y: 310 },
      { x: 50, y: 10 }
    );
    tc.destroy();
  });

  it('consumeInput() safely reports and resets buffered tap/drag state for game ticks', () => {
    const listeners = {};
    const mockElement = {
      addEventListener: vi.fn((type, fn) => {
        listeners[type] = fn;
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 400, height: 800 })
    };

    const tc = new TouchController(mockElement);

    listeners['touchstart']({
      cancelable: true,
      preventDefault: vi.fn(),
      changedTouches: [{ identifier: 1, clientX: 100, clientY: 200 }]
    });

    const firstPoll = tc.consumeInput();
    expect(firstPoll.flipGravity).toBe(true);
    expect(firstPoll.active).toBe(true);
    expect(firstPoll.virtualX).toBe(100);

    // Second poll should consume and reset flipGravity
    const secondPoll = tc.consumeInput();
    expect(secondPoll.flipGravity).toBe(false);
    expect(secondPoll.active).toBe(true);

    tc.destroy();
  });
});

describe('Milestone 1: Service Worker Script Syntax & Architecture (sw.js)', () => {
  const swPath = path.join(projectRoot, 'sw.js');

  it('sw.js exists and contains valid JavaScript syntax', () => {
    expect(fs.existsSync(swPath)).toBe(true);
    const content = fs.readFileSync(swPath, 'utf8');
    expect(content.length).toBeGreaterThan(100);

    // Verify syntax validity using Node vm
    expect(() => {
      new vm.Script(content);
    }).not.toThrow();
  });

  it('sw.js declares cache versioning and PRECACHE_ASSETS list', () => {
    const content = fs.readFileSync(swPath, 'utf8');
    expect(content).toMatch(/CACHE_VERSION\s*=\s*['"]v\d+\.\d+\.\d+['"]/);
    expect(content).toMatch(/CACHE_NAME\s*=/);
    expect(content).toContain('PRECACHE_ASSETS');
    expect(content).toContain('./index.html');
    expect(content).toContain('./style.css');
    expect(content).toContain('./manifest.webmanifest');
  });

  it('sw.js implements immediate takeover via skipWaiting() and clients.claim()', () => {
    const content = fs.readFileSync(swPath, 'utf8');
    expect(content).toContain('self.skipWaiting()');
    expect(content).toContain('self.clients.claim()');
  });

  it('sw.js implements query-string neutral navigation with ignoreSearch: true', () => {
    const content = fs.readFileSync(swPath, 'utf8');
    expect(content).toContain("request.mode === 'navigate'");
    expect(content).toContain('ignoreSearch: true');
  });
});

describe('Milestone 1: Web App Manifest & Icons Verification', () => {
  const manifestPath = path.join(projectRoot, 'manifest.webmanifest');

  it('manifest.webmanifest is valid JSON with required PWA metadata', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(json.name).toBe('AntiGravity: Neon Pulse');
    expect(json.short_name).toBe('AntiGravity');
    expect(json.display).toBe('standalone');
    expect(json.orientation).toBe('portrait');
    expect(json.theme_color).toBe('#0a0a16');
    expect(json.background_color).toBe('#0a0a16');
    expect(json.start_url).toBe('./index.html');
  });

  it('manifest declares standard, maskable, and SVG icons', () => {
    const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons.length).toBeGreaterThanOrEqual(3);

    const has192 = json.icons.some(i => i.sizes === '192x192' && i.src.includes('192'));
    const has512 = json.icons.some(i => i.sizes === '512x512' && i.src.includes('512'));
    const hasMaskable = json.icons.some(i => i.purpose === 'maskable');
    const hasSvg = json.icons.some(i => i.type === 'image/svg+xml');

    expect(has192).toBe(true);
    expect(has512).toBe(true);
    expect(hasMaskable).toBe(true);
    expect(hasSvg).toBe(true);
  });

  it('all referenced icon files physically exist on disk and have valid headers', () => {
    const iconsDir = path.join(projectRoot, 'icons');
    const requiredFiles = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon.svg'];

    for (const file of requiredFiles) {
      const filePath = path.join(iconsDir, file);
      expect(fs.existsSync(filePath), `Icon ${file} must exist`).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);

      if (file.endsWith('.png')) {
        // Verify PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
        const buf = fs.readFileSync(filePath);
        const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        for (let i = 0; i < 8; i++) {
          expect(buf[i]).toBe(pngHeader[i]);
        }
      }
    }
  });
});

describe('Milestone 1: Procedural Web Audio Synthesizer (src/audio.js)', () => {
  it('SoundEngine exports methods conforming to PROJECT.md interface contract', () => {
    const engine = new SoundEngine();
    expect(typeof engine.ensureContext).toBe('function');
    expect(typeof engine.playJump).toBe('function');
    expect(typeof engine.playCombo).toBe('function');
    expect(typeof engine.playNearMiss).toBe('function');
    expect(typeof engine.playCrash).toBe('function');
    expect(typeof engine.playFanfare).toBe('function');
    expect(typeof engine.toggleMute).toBe('function');
  });

  it('toggleMute toggles mute state cleanly', () => {
    const engine = new SoundEngine();
    expect(engine.isMuted).toBe(false);

    engine.toggleMute();
    expect(engine.isMuted).toBe(true);

    engine.toggleMute(false);
    expect(engine.isMuted).toBe(false);
  });

  it('sound triggers execute safely without crashing in headless/uninitialized environments', () => {
    const engine = new SoundEngine();
    // In node/headless environment without AudioContext, methods should safely no-op
    expect(() => {
      engine.playJump();
      engine.playCombo(1);
      engine.playCombo(5);
      engine.playNearMiss();
      engine.playCrash();
      engine.playFanfare();
    }).not.toThrow();
  });

  it('SoundEngine.init() static factory method instantiates engine', () => {
    const engine = SoundEngine.init();
    expect(engine).toBeInstanceOf(SoundEngine);
  });
});

describe('Milestone 1: PWA Shell HTML & CSS Specifications', () => {
  const htmlPath = path.join(projectRoot, 'index.html');
  const cssPath = path.join(projectRoot, 'style.css');

  it('index.html contains mobile viewport meta, manifest link, and safe area setup', () => {
    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Viewport meta tag
    expect(html).toContain('name="viewport"');
    expect(html).toContain('width=device-width');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('user-scalable=no');

    // Manifest and theme tags
    expect(html).toContain('rel="manifest" href="./manifest.webmanifest"');
    expect(html).toContain('name="theme-color" content="#0a0a16"');

    // Canvas and HUD elements
    expect(html).toContain('id="game-canvas"');
    expect(html).toContain('id="hud-top"');
    expect(html).toContain('id="start-screen"');
    expect(html).toContain('id="game-over-screen"');

    // Service worker script
    expect(html).toContain('serviceWorker.register');
  });

  it('style.css enforces mobile gesture prevention and safe area insets', () => {
    expect(fs.existsSync(cssPath)).toBe(true);
    const css = fs.readFileSync(cssPath, 'utf8');

    // Safe area environment variables
    expect(css).toContain('env(safe-area-inset-top');
    expect(css).toContain('env(safe-area-inset-bottom');

    // Critical mobile touch isolation rules
    expect(css).toContain('touch-action: none');
    expect(css).toContain('overscroll-behavior: none');
    expect(css).toContain('-webkit-touch-callout: none');
    expect(css).toContain('user-select: none');

    // AMOLED background color
    expect(css).toContain('#050508');
  });
});

describe('Milestone 1: Zero-Dependency Local Preview Server (preview.js)', () => {
  let serverInstance = null;
  let testPort = 0;

  beforeEach(async () => {
    const { createPreviewServer } = await import('../../preview.js');
    serverInstance = createPreviewServer(projectRoot);
    await new Promise((resolve) => {
      // Listen on random available port
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

  it('serves index.html on root request with text/html content-type', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('AntiGravity: Neon Pulse');
  });

  it('serves manifest.webmanifest with application/manifest+json content-type', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/manifest+json');
    const json = await res.json();
    expect(json.name).toBe('AntiGravity: Neon Pulse');
  });

  it('sets no-cache headers for service worker (sw.js)', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');
  });

  it('returns 404 for non-existent files', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/non-existent-asset.xyz`);
    expect(res.status).toBe(404);
  });
});


