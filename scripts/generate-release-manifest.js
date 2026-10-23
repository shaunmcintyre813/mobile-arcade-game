import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const TRACKED_FILES = [
  'index.html',
  'favicon.ico',
  'style.css',
  'manifest.webmanifest',
  'src/audio.js',
  'src/display.js',
  'src/game.js',
  'src/obstacles.js',
  'src/particles.js',
  'src/player.js',
  'src/rails.js',
  'src/score.js',
  'src/share.js',
  'src/touch.js',
  'src/ui.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

export function computeFileHash(absolutePath) {
  const content = fs.readFileSync(absolutePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function generateManifest(rootDirectory = repoRoot, customVersion = null) {
  const packageJsonPath = path.join(rootDirectory, 'package.json');
  let baseVersion = '1.0.0';
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (pkg.version) baseVersion = pkg.version;
    } catch (_) {}
  }

  const manifest = {
    version: customVersion || baseVersion,
    generatedAt: new Date().toISOString(),
    files: {}
  };

  for (const relativePath of TRACKED_FILES) {
    const fullPath = path.join(rootDirectory, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Tracked release file missing: ${relativePath} at ${fullPath}`);
    }
    manifest.files[relativePath] = computeFileHash(fullPath);
  }

  return manifest;
}

// CLI usage
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const customVer = process.argv[2] || null;
  const manifest = generateManifest(repoRoot, customVer);
  const outputPath = path.join(repoRoot, 'release-manifest.json');
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Generated release-manifest.json (version: ${manifest.version}, files: ${Object.keys(manifest.files).length})`);
}
