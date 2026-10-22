import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateManifest, computeFileHash, TRACKED_FILES } from '../../scripts/generate-release-manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

describe('Release Manifest Generation & Integrity', () => {
  it('generates a valid release manifest covering all required assets', () => {
    const manifest = generateManifest(repoRoot, '1.1.0');
    expect(manifest.version).toBe('1.1.0');
    expect(typeof manifest.generatedAt).toBe('string');
    expect(Object.keys(manifest.files).length).toBe(TRACKED_FILES.length);

    for (const file of TRACKED_FILES) {
      expect(manifest.files).toHaveProperty(file);
      expect(manifest.files[file]).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('hashes correctly reflect disk content', () => {
    const testFile = 'index.html';
    const computed = computeFileHash(path.join(repoRoot, testFile));
    const manifest = generateManifest(repoRoot);
    expect(manifest.files[testFile]).toBe(computed);
  });
});
