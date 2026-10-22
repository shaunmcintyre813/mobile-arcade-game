import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageController, STORAGE_KEY } from '../../src/score.js';

describe('StorageController Native Android Bridge migration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads high score from Native Android SharedPreferences when localStorage is empty', () => {
    const mockStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    };

    vi.stubGlobal('window', {
      AntiGravityAndroid: {
        getSavedHighScore: () => 1850
      }
    });

    const controller = new StorageController(mockStorage);
    const score = controller.getHighScore();

    expect(score).toBe(1850);
    expect(mockStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '1850');
  });

  it('migrates higher Native Android score over lower localStorage score', () => {
    const mockStorage = {
      getItem: vi.fn(() => '900'),
      setItem: vi.fn()
    };

    vi.stubGlobal('window', {
      AntiGravityAndroid: {
        getSavedHighScore: () => 2400
      }
    });

    const controller = new StorageController(mockStorage);
    const score = controller.getHighScore();

    expect(score).toBe(2400);
    expect(mockStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '2400');
  });

  it('keeps higher localStorage score when Native Android score is lower', () => {
    const mockStorage = {
      getItem: vi.fn(() => '3500'),
      setItem: vi.fn()
    };

    vi.stubGlobal('window', {
      AntiGravityAndroid: {
        getSavedHighScore: () => 1200
      }
    });

    const controller = new StorageController(mockStorage);
    const score = controller.getHighScore();

    expect(score).toBe(3500);
  });
});
