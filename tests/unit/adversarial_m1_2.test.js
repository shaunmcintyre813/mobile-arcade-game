import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

import { SoundEngine } from '../../src/audio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

// Helper: Standard CRC32 table & calculation for PNG chunk verification
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function computeCRC32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Helper: Parse PNG file structure into chunks and validate
function parsePNG(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.subarray(0, 8);
  const expectedMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isMagicValid = magic.equals(expectedMagic);

  const chunks = [];
  let offset = 8;
  let ihdr = null;
  const idatBuffers = [];

  while (offset < buf.length) {
    if (offset + 12 > buf.length) {
      throw new Error(`Truncated chunk header at offset ${offset}`);
    }
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    const storedCrc = buf.readUInt32BE(offset + 8 + len);
    const typeAndData = buf.subarray(offset + 4, offset + 8 + len);
    const calculatedCrc = computeCRC32(typeAndData);

    const chunk = {
      type,
      length: len,
      data,
      storedCrc,
      calculatedCrc,
      crcValid: storedCrc === calculatedCrc
    };
    chunks.push(chunk);

    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idatBuffers.push(data);
    }

    offset += 12 + len;
  }

  const combinedIdat = Buffer.concat(idatBuffers);
  const decompressed = zlib.inflateSync(combinedIdat);

  return {
    rawBuffer: buf,
    fileSize: buf.length,
    isMagicValid,
    chunks,
    ihdr,
    idatLength: combinedIdat.length,
    decompressed
  };
}

// ============================================================================
// SUITE 1: Binary PNG Icons Adversarial Inspection
// ============================================================================
describe('Adversarial Asset Verification: Binary PNG Icons', () => {
  const iconsDir = path.join(projectRoot, 'icons');

  it('icon-192.png adheres to strict PNG specification and dimensions', () => {
    const pngPath = path.join(iconsDir, 'icon-192.png');
    expect(fs.existsSync(pngPath)).toBe(true);

    const parsed = parsePNG(pngPath);
    expect(parsed.isMagicValid).toBe(true);
    expect(parsed.fileSize).toBeGreaterThan(1000); // non-empty, genuine image

    // Validate IHDR
    expect(parsed.ihdr).not.toBeNull();
    expect(parsed.ihdr.width).toBe(192);
    expect(parsed.ihdr.height).toBe(192);
    expect(parsed.ihdr.bitDepth).toBe(8);
    expect(parsed.ihdr.colorType).toBe(6); // RGBA
    expect(parsed.ihdr.compression).toBe(0);
    expect(parsed.ihdr.filter).toBe(0);
    expect(parsed.ihdr.interlace).toBe(0);

    // Validate every chunk's CRC32
    for (const chunk of parsed.chunks) {
      expect(chunk.crcValid, `CRC mismatch in chunk ${chunk.type}`).toBe(true);
    }

    // Verify scanline layout: 192 rows * (1 filter byte + 192 * 4 bytes RGBA)
    const expectedDecompressedSize = 192 * (1 + 192 * 4);
    expect(parsed.decompressed.length).toBe(expectedDecompressedSize);
  });

  it('icon-512.png adheres to strict PNG specification and dimensions', () => {
    const pngPath = path.join(iconsDir, 'icon-512.png');
    expect(fs.existsSync(pngPath)).toBe(true);

    const parsed = parsePNG(pngPath);
    expect(parsed.isMagicValid).toBe(true);
    expect(parsed.fileSize).toBeGreaterThan(5000);

    // Validate IHDR
    expect(parsed.ihdr).not.toBeNull();
    expect(parsed.ihdr.width).toBe(512);
    expect(parsed.ihdr.height).toBe(512);
    expect(parsed.ihdr.bitDepth).toBe(8);
    expect(parsed.ihdr.colorType).toBe(6); // RGBA

    // Validate chunk CRC32
    for (const chunk of parsed.chunks) {
      expect(chunk.crcValid, `CRC mismatch in chunk ${chunk.type}`).toBe(true);
    }

    // Verify scanline layout: 512 rows * (1 filter byte + 512 * 4 bytes RGBA)
    const expectedDecompressedSize = 512 * (1 + 512 * 4);
    expect(parsed.decompressed.length).toBe(expectedDecompressedSize);
  });

  it('icon-maskable-512.png adheres to 80% safe zone and opacity rules', () => {
    const pngPath = path.join(iconsDir, 'icon-maskable-512.png');
    expect(fs.existsSync(pngPath)).toBe(true);

    const parsed = parsePNG(pngPath);
    expect(parsed.isMagicValid).toBe(true);
    expect(parsed.ihdr.width).toBe(512);
    expect(parsed.ihdr.height).toBe(512);

    const width = 512;
    const height = 512;
    const rowStride = 1 + width * 4;
    const cx = width / 2;
    const cy = height / 2;
    const safeRadius = width * 0.40; // 80% safe circle diameter = 409.6px, radius = 204.8px

    let transparentPixelsCount = 0;
    let nonOpaquePixelsCount = 0;
    let outsideBrightPixels = 0;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * rowStride;
      const filterByte = parsed.decompressed[rowOffset];
      expect(filterByte).toBeGreaterThanOrEqual(0);
      expect(filterByte).toBeLessThanOrEqual(4);

      for (let x = 0; x < width; x++) {
        const pxOffset = rowOffset + 1 + x * 4;
        const r = parsed.decompressed[pxOffset];
        const g = parsed.decompressed[pxOffset + 1];
        const b = parsed.decompressed[pxOffset + 2];
        const a = parsed.decompressed[pxOffset + 3];

        if (a === 0) transparentPixelsCount++;
        if (a < 255) nonOpaquePixelsCount++;

        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Outside safe radius: maskable icons must not have foreground logos cut off,
        // and must have continuous background fill (no high-brightness elements).
        if (dist > safeRadius) {
          // Foreground neon accents have high intensity (e.g. bright cyan > 100 or magenta > 100)
          if (r > 60 || g > 60 || b > 80) {
            outsideBrightPixels++;
          }
        }
      }
    }

    // Rule 1: No transparent or semi-transparent pixels in maskable icon
    expect(transparentPixelsCount, 'Maskable icon must not have transparent pixels').toBe(0);
    expect(nonOpaquePixelsCount, 'Maskable icon must be 100% opaque').toBe(0);

    // Rule 2: No bright foreground elements leaking outside 80% safe zone
    expect(outsideBrightPixels, 'No bright foreground elements outside 80% safe zone').toBe(0);
  });

  it('icon.svg is valid XML and has proper SVG viewBox', () => {
    const svgPath = path.join(iconsDir, 'icon.svg');
    expect(fs.existsSync(svgPath)).toBe(true);

    const svgContent = fs.readFileSync(svgPath, 'utf8');
    expect(svgContent.startsWith('<svg')).toBe(true);
    expect(svgContent).toContain('viewBox="0 0 512 512"');
    expect(svgContent).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svgContent.endsWith('</svg>\n') || svgContent.endsWith('</svg>')).toBe(true);
  });
});

// ============================================================================
// SUITE 2: manifest.webmanifest Adversarial Validation
// ============================================================================
describe('Adversarial PWA Validation: manifest.webmanifest', () => {
  const manifestPath = path.join(projectRoot, 'manifest.webmanifest');

  it('manifest conforms to W3C Web App Manifest specification', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const content = fs.readFileSync(manifestPath, 'utf8');

    let manifest;
    expect(() => {
      manifest = JSON.parse(content);
    }).not.toThrow();

    // Required fields for installability
    expect(manifest.name).toBe('AntiGravity: Neon Pulse');
    expect(manifest.short_name).toBe('AntiGravity');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);

    expect(manifest.start_url).toBe('/mobile-arcade-game/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');

    // Color definitions
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);

    // Scope and id
    expect(manifest.scope).toBe('/mobile-arcade-game/');
    expect(manifest.id).toBe('/mobile-arcade-game/');

    // Direction and language
    expect(manifest.lang).toBe('en');
    expect(manifest.dir).toBe('ltr');
  });

  it('all manifest icons exist on disk with correct relative paths and MIME types', () => {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    for (const icon of manifest.icons) {
      expect(icon.src).toBeDefined();
      expect(icon.sizes).toBeDefined();
      expect(icon.type).toBeDefined();

      // Resolve path relative to manifest
      const resolvedIconPath = path.resolve(projectRoot, icon.src);
      expect(fs.existsSync(resolvedIconPath), `Missing icon on disk: ${icon.src}`).toBe(true);

      const stat = fs.statSync(resolvedIconPath);
      expect(stat.size).toBeGreaterThan(0);

      // Verify MIME type matches file extension
      if (icon.src.endsWith('.png')) {
        expect(icon.type).toBe('image/png');
      } else if (icon.src.endsWith('.svg')) {
        expect(icon.type).toBe('image/svg+xml');
      }
    }
  });

  it('contains dedicated maskable icon with sizes 512x512', () => {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    const maskableIcon = manifest.icons.find(i => i.purpose === 'maskable');
    expect(maskableIcon).toBeDefined();
    expect(maskableIcon.sizes).toBe('512x512');
    expect(maskableIcon.src).toContain('maskable');
  });
});

// ============================================================================
// SUITE 3: SoundEngine Adversarial Stress Testing
// ============================================================================
describe('Adversarial Audio Engine Stress Testing: SoundEngine', () => {
  // Mock Web Audio API implementation with call counting & state tracking
  function createMockAudioContext() {
    let currentTime = 0;
    const createdNodes = {
      oscillators: [],
      gains: [],
      filters: [],
      buffers: []
    };

    class MockAudioParam {
      constructor(val = 0) {
        this.value = val;
        this.scheduledEvents = [];
      }
      setValueAtTime(val, time) {
        if (!Number.isFinite(val)) throw new TypeError(`AudioParam.setValueAtTime non-finite value: ${val}`);
        this.scheduledEvents.push({ type: 'setValueAtTime', val, time });
        this.value = val;
      }
      exponentialRampToValueAtTime(val, time) {
        if (!Number.isFinite(val) || val <= 0) throw new TypeError(`AudioParam.exponentialRampToValueAtTime invalid value: ${val}`);
        this.scheduledEvents.push({ type: 'exponentialRampToValueAtTime', val, time });
        this.value = val;
      }
      linearRampToValueAtTime(val, time) {
        if (!Number.isFinite(val)) throw new TypeError(`AudioParam.linearRampToValueAtTime non-finite value: ${val}`);
        this.scheduledEvents.push({ type: 'linearRampToValueAtTime', val, time });
        this.value = val;
      }
      cancelScheduledValues(time) {
        this.scheduledEvents = this.scheduledEvents.filter(e => e.time < time);
      }
    }

    class MockGainNode {
      constructor() {
        this.gain = new MockAudioParam(1.0);
        this.connectedTo = [];
        createdNodes.gains.push(this);
      }
      connect(target) {
        this.connectedTo.push(target);
      }
      disconnect() {
        this.connectedTo = [];
      }
    }

    class MockOscillatorNode {
      constructor() {
        this.frequency = new MockAudioParam(440);
        this.type = 'sine';
        this.startTime = null;
        this.stopTime = null;
        this.connectedTo = [];
        createdNodes.oscillators.push(this);
      }
      connect(target) {
        this.connectedTo.push(target);
      }
      disconnect() {
        this.connectedTo = [];
      }
      start(time) {
        this.startTime = time;
      }
      stop(time) {
        this.stopTime = time;
      }
    }

    class MockBiquadFilterNode {
      constructor() {
        this.frequency = new MockAudioParam(1000);
        this.Q = new MockAudioParam(1);
        this.type = 'lowpass';
        this.connectedTo = [];
        createdNodes.filters.push(this);
      }
      connect(target) {
        this.connectedTo.push(target);
      }
      disconnect() {
        this.connectedTo = [];
      }
    }

    class MockBufferSourceNode {
      constructor() {
        this.buffer = null;
        this.startTime = null;
        this.stopTime = null;
        this.connectedTo = [];
        createdNodes.buffers.push(this);
      }
      connect(target) {
        this.connectedTo.push(target);
      }
      disconnect() {
        this.connectedTo = [];
      }
      start(time) {
        this.startTime = time;
      }
      stop(time) {
        this.stopTime = time;
      }
    }

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.sampleRate = 44100;
        this.destination = { id: 'destination' };
      }
      get currentTime() {
        return currentTime;
      }
      createGain() {
        return new MockGainNode();
      }
      createOscillator() {
        return new MockOscillatorNode();
      }
      createBiquadFilter() {
        return new MockBiquadFilterNode();
      }
      createBufferSource() {
        return new MockBufferSourceNode();
      }
      createBuffer(channels, length, sampleRate) {
        return {
          channels,
          length,
          sampleRate,
          getChannelData: () => new Float32Array(length)
        };
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
    }

    return {
      MockAudioContext,
      createdNodes,
      advanceTime: (dt) => { currentTime += dt; }
    };
  }

  it('runs safely when window or Web Audio API is undefined (Headless Node)', () => {
    // Delete window
    const originalWindow = global.window;
    delete global.window;

    try {
      const engine = new SoundEngine();
      expect(engine.ctx).toBeNull();

      // Ensure no method throws
      expect(() => {
        engine.playJump();
        engine.playCombo(1);
        engine.playNearMiss();
        engine.playCrash();
        engine.playFanfare();
        engine.toggleMute();
      }).not.toThrow();
    } finally {
      global.window = originalWindow;
    }
  });

  it('runs safely when AudioContext constructor throws (e.g. security policy / disabled audio)', () => {
    global.window = {
      AudioContext: vi.fn().mockImplementation(() => {
        throw new Error('NotAllowedError: AudioContext is not permitted in this context');
      }),
      addEventListener: vi.fn()
    };

    const engine = new SoundEngine();
    const ctx = engine.ensureContext();
    expect(ctx).toBeNull();

    // Verify all sound methods gracefully no-op without uncaught errors
    expect(() => {
      engine.playJump();
      engine.playCombo(3);
      engine.playNearMiss();
      engine.playCrash();
      engine.playFanfare();
    }).not.toThrow();
  });

  it('handles 50x rapid-fire playJump triggers in 100ms without crashing or uncaught errors', () => {
    const { MockAudioContext, createdNodes, advanceTime } = createMockAudioContext();
    global.window = {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn()
    };

    const engine = new SoundEngine();
    engine.ensureContext();

    // Initial master gain created
    expect(createdNodes.gains.length).toBe(1);

    // Rapid-fire 50x jump calls spaced across 100ms
    const numTriggers = 50;
    for (let i = 0; i < numTriggers; i++) {
      expect(() => engine.playJump()).not.toThrow();
      advanceTime(0.002); // 2ms per iteration = 100ms total
    }

    // Verify exactly 50 oscillators and 50 gain nodes were spawned
    expect(createdNodes.oscillators.length).toBe(50);
    // 1 master gain + 50 jump gains = 51 gains
    expect(createdNodes.gains.length).toBe(51);

    // Verify every oscillator was scheduled with start and stop times
    for (const osc of createdNodes.oscillators) {
      expect(osc.startTime).not.toBeNull();
      expect(osc.stopTime).not.toBeNull();
      expect(osc.stopTime - osc.startTime).toBeCloseTo(0.08, 3);
    }
  });

  it('handles extreme out-of-bounds combo numbers without uncaught exceptions or non-finite values', () => {
    const { MockAudioContext, createdNodes } = createMockAudioContext();
    global.window = {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn()
    };

    const engine = new SoundEngine();
    engine.ensureContext();

    const extremeInputs = [
      -9999,
      -1,
      0,
      1,
      8,
      9,
      999,
      999999,
      Infinity,
      -Infinity,
      null,
      undefined,
      '5',
      'invalid',
      NaN
    ];

    for (const input of extremeInputs) {
      // Must not throw uncaught error to user/game loop
      expect(() => {
        engine.playCombo(input);
      }, `Failed on combo input: ${input}`).not.toThrow();
    }
  });

  it('playCrash and all other sounds do not create audio nodes when muted', () => {
    const { MockAudioContext, createdNodes } = createMockAudioContext();
    global.window = {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn()
    };

    const engine = new SoundEngine();
    engine.ensureContext();

    // Initial state: 1 master gain node
    expect(createdNodes.oscillators.length).toBe(0);
    expect(createdNodes.gains.length).toBe(1);
    expect(createdNodes.buffers.length).toBe(0);

    // Mute the engine
    engine.toggleMute(true);
    expect(engine.isMuted).toBe(true);

    const oscCountBefore = createdNodes.oscillators.length;
    const gainCountBefore = createdNodes.gains.length;
    const bufferCountBefore = createdNodes.buffers.length;

    // Trigger all sounds while muted
    engine.playJump();
    engine.playCombo(5);
    engine.playCrash();
    engine.playNearMiss();
    engine.playFanfare();

    // Verify no new nodes were created while muted
    expect(createdNodes.oscillators.length).toBe(oscCountBefore);
    expect(createdNodes.gains.length).toBe(gainCountBefore);
    expect(createdNodes.buffers.length).toBe(bufferCountBefore);
  });

  it('unmuting restores playback and resumes master gain', () => {
    const { MockAudioContext, createdNodes } = createMockAudioContext();
    global.window = {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn()
    };

    const engine = new SoundEngine();
    engine.ensureContext();

    engine.toggleMute(true);
    expect(engine.isMuted).toBe(true);

    engine.toggleMute(false);
    expect(engine.isMuted).toBe(false);

    engine.playJump();
    expect(createdNodes.oscillators.length).toBe(1);
  });
});
