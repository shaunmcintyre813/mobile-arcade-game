import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const scope = 'https://shaunmcintyre813.github.io/mobile-arcade-game/';

function createWorker() {
  const listeners = new Map();
  const cachedIndex = { status: 200, body: 'game HTML' };
  const cachePut = vi.fn(async () => {});
  const cacheMatch = vi.fn(async () => cachedIndex);
  const fetch = vi.fn(async () => ({ status: 200, clone: () => ({ status: 200 }) }));
  const self = {
    registration: { scope },
    addEventListener: (name, listener) => listeners.set(name, listener)
  };

  vm.runInNewContext(workerSource, {
    self,
    caches: {
      match: cacheMatch,
      open: async () => ({ put: cachePut })
    },
    fetch,
    URL,
    Response,
    Headers
  });

  return { fetchHandler: listeners.get('fetch'), cachedIndex, cacheMatch, cachePut, fetch };
}

function navigation(url) {
  let responsePromise;
  const event = {
    request: { method: 'GET', mode: 'navigate', url },
    respondWith: vi.fn((response) => { responsePromise = response; })
  };
  return { event, response: () => responsePromise };
}

describe('Service worker app-shell navigation', () => {
  it('never intercepts a direct manifest navigation or caches its JSON as HTML', () => {
    const worker = createWorker();
    const visit = navigation(`${scope}manifest.webmanifest`);

    worker.fetchHandler(visit.event);

    expect(visit.event.respondWith).not.toHaveBeenCalled();
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.cachePut).not.toHaveBeenCalled();
  });

  it('still serves a cached game for a challenge link', async () => {
    const worker = createWorker();
    const visit = navigation(`${scope}?c=500&by=Friend`);

    worker.fetchHandler(visit.event);

    expect(visit.event.respondWith).toHaveBeenCalledOnce();
    expect(await visit.response()).toBe(worker.cachedIndex);
    expect(worker.cacheMatch).toHaveBeenCalledWith('./index.html', { ignoreSearch: true });
  });
});
