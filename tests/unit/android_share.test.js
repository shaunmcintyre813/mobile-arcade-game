import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareController } from '../../src/share.js';

afterEach(() => vi.unstubAllGlobals());

describe('bundled Android challenge sharing', () => {
  it('shares a public URL through the native sheet instead of the local asset URL', async () => {
    const share = vi.fn();
    vi.stubGlobal('window', {
      location: {
        hostname: 'appassets.androidplatform.net',
        origin: 'https://appassets.androidplatform.net',
        pathname: '/index.html',
        protocol: 'https:'
      },
      AntiGravityAndroid: { share }
    });

    const result = await new ShareController().shareScore({ score: 1250, playerName: 'Alex' });

    expect(result).toEqual({ success: true, method: 'android-share', cancelled: false });
    expect(share).toHaveBeenCalledWith(
      'Can you beat my score of 1250 in AntiGravity?',
      'https://shaunmcintyre813.github.io/mobile-arcade-game/?c=1250&by=Alex'
    );
  });
});
