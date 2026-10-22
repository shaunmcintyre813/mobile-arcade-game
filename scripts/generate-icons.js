import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// CRC32 implementation for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const typeAndData = buf.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

function createPNG(width, height, pixelFn) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8-bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw scanlines with filter type 0 (None)
  const scanlineSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * scanlineSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineSize;
    rawData[rowOffset] = 0; // Filter byte 0
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y, width, height);
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate Standard Icon (192 and 512)
function standardIconPixel(x, y, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Background dark cyber gradient (#0e0e24 to #05050a)
  const normY = y / height;
  let r = Math.round(14 - normY * 9);
  let g = Math.round(14 - normY * 9);
  let b = Math.round(36 - normY * 26);
  let a = 255;

  // Left Cyan Rail (x ≈ 0.23 * width)
  const railLeftX = width * 0.23;
  const distRailL = Math.abs(x - railLeftX);
  if (distRailL < width * 0.08 && y > height * 0.12 && y < height * 0.88) {
    const glowL = Math.max(0, 1 - distRailL / (width * 0.08));
    r = Math.min(255, Math.round(r + 0 * glowL));
    g = Math.min(255, Math.round(g + 240 * glowL * glowL));
    b = Math.min(255, Math.round(b + 255 * glowL));
    if (distRailL < width * 0.015) {
      // Core bright rail line
      r = 255; g = 255; b = 255;
    }
  }

  // Right Magenta Rail (x ≈ 0.77 * width)
  const railRightX = width * 0.77;
  const distRailR = Math.abs(x - railRightX);
  if (distRailR < width * 0.08 && y > height * 0.12 && y < height * 0.88) {
    const glowR = Math.max(0, 1 - distRailR / (width * 0.08));
    r = Math.min(255, Math.round(r + 255 * glowR));
    g = Math.min(255, Math.round(g + 0 * glowR));
    b = Math.min(255, Math.round(b + 85 * glowR * glowR));
    if (distRailR < width * 0.015) {
      // Core bright rail line
      r = 255; g = 255; b = 255;
    }
  }

  // Radial Cyan Glow around center
  const glowRadius = width * 0.35;
  if (dist < glowRadius) {
    const aura = Math.max(0, 1 - dist / glowRadius);
    r = Math.min(255, Math.round(r + 0 * aura));
    g = Math.min(255, Math.round(g + 180 * aura * aura));
    b = Math.min(255, Math.round(b + 255 * aura * aura));
  }

  // Central AntiGravity Diamond Spark
  // Diamond condition: |dx| / diamondW + |dy| / diamondH <= 1
  const dW = width * 0.16;
  const dH = height * 0.22;
  const dVal = Math.abs(dx) / dW + Math.abs(dy) / dH;

  if (dVal <= 1.0) {
    if (dVal <= 0.45) {
      // Intense white core
      r = 255; g = 255; b = 255;
    } else if (dVal <= 0.75) {
      // Electric Gold / Amber
      r = 255; g = 230; b = 0;
    } else {
      // Bright Cyan outer shell
      r = 0; g = 240; b = 255;
    }
  }

  return [r, g, b, a];
}

// Generate Maskable Icon (80% safe zone)
function maskableIconPixel(x, y, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const safeRadius = width * 0.40; // 80% diameter safe circle

  // Base background is solid #0a0a16 everywhere
  let r = 10;
  let g = 10;
  let b = 22;
  let a = 255;

  // Outer gradient
  const normY = y / height;
  r = Math.round(14 - normY * 9);
  g = Math.round(14 - normY * 9);
  b = Math.round(30 - normY * 20);

  // If inside safe zone (with slight anti-aliasing margin)
  if (dist <= safeRadius) {
    // Left Cyan Rail (scaled within safe zone)
    const railLeftX = width * 0.28;
    const distRailL = Math.abs(x - railLeftX);
    if (distRailL < width * 0.07 && Math.abs(dy) < height * 0.32) {
      const glowL = Math.max(0, 1 - distRailL / (width * 0.07));
      r = Math.min(255, Math.round(r + 0 * glowL));
      g = Math.min(255, Math.round(g + 240 * glowL * glowL));
      b = Math.min(255, Math.round(b + 255 * glowL));
      if (distRailL < width * 0.012) {
        r = 255; g = 255; b = 255;
      }
    }

    // Right Magenta Rail (scaled within safe zone)
    const railRightX = width * 0.72;
    const distRailR = Math.abs(x - railRightX);
    if (distRailR < width * 0.07 && Math.abs(dy) < height * 0.32) {
      const glowR = Math.max(0, 1 - distRailR / (width * 0.07));
      r = Math.min(255, Math.round(r + 255 * glowR));
      g = Math.min(255, Math.round(g + 0 * glowR));
      b = Math.min(255, Math.round(b + 85 * glowR * glowR));
      if (distRailR < width * 0.012) {
        r = 255; g = 255; b = 255;
      }
    }

    // Central glow aura
    const glowRadius = width * 0.28;
    if (dist < glowRadius) {
      const aura = Math.max(0, 1 - dist / glowRadius);
      r = Math.min(255, Math.round(r + 0 * aura));
      g = Math.min(255, Math.round(g + 180 * aura * aura));
      b = Math.min(255, Math.round(b + 255 * aura * aura));
    }

    // Central AntiGravity Diamond Spark
    const dW = width * 0.13;
    const dH = height * 0.18;
    const dVal = Math.abs(dx) / dW + Math.abs(dy) / dH;

    if (dVal <= 1.0) {
      if (dVal <= 0.45) {
        r = 255; g = 255; b = 255;
      } else if (dVal <= 0.75) {
        r = 255; g = 230; b = 0;
      } else {
        r = 0; g = 240; b = 255;
      }
    }
  }

  return [r, g, b, a];
}

console.log('Generating PNG icons...');

const png192 = createPNG(192, 192, standardIconPixel);
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), png192);
console.log('Saved icon-192.png (' + png192.length + ' bytes)');

const png512 = createPNG(512, 512, standardIconPixel);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), png512);
console.log('Saved icon-512.png (' + png512.length + ' bytes)');

const pngMaskable512 = createPNG(512, 512, maskableIconPixel);
fs.writeFileSync(path.join(iconsDir, 'icon-maskable-512.png'), pngMaskable512);
console.log('Saved icon-maskable-512.png (' + pngMaskable512.length + ' bytes)');

console.log('All icons generated successfully!');
