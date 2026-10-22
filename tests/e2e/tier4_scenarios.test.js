import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DisplayManager } from '../../src/display.js';
import { TouchController } from '../../src/touch.js';
import { SoundEngine } from '../../src/audio.js';
import { Player, RAIL_X_LEFT, RAIL_X_RIGHT } from '../../src/player.js';
import { ObstacleManager } from '../../src/obstacles.js';
import { ScoreManager, StorageController, STORAGE_KEY } from '../../src/score.js';
import { ShareController } from '../../src/share.js';
import { UIManager } from '../../src/ui.js';
import { GameEngine, STATE_START, STATE_PLAYING, STATE_GAME_OVER } from '../../src/game.js';
import { setupFullE2EEnvironment, createMockCanvas } from '../fixtures/e2e_harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

describe('Tier 4: Real-World User Journeys (Opaque-Box E2E)', () => {
  let env;

  beforeEach(() => {
    env = setupFullE2EEnvironment();
  });

  afterEach(() => {
    if (env) {
      env.cleanup();
    }
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Scenario 1: First-Time Mobile Player (Onboarding & Instant Gratification)
  // =========================================================================
  describe('Scenario 1: First-Time Mobile Player (Onboarding & Instant Gratification)', () => {
    it('guides new player from PWA title screen, one-thumb tap-to-start, initial run, crash, and instant replay', () => {
      const storage = new StorageController();
      expect(storage.getHighScore()).toBe(0);

      const game = new GameEngine(env.canvas, { storageController: storage });

      // Step 1: Player opens PWA shell on Samsung Galaxy S25 Ultra
      expect(game.state).toBe(STATE_START);
      expect(env.elements['start-screen'].classList.contains('hidden')).toBe(false);
      expect(env.elements['game-over-screen'].classList.contains('hidden')).toBe(true);

      // Step 2: Player taps screen -> audio unlocks, start screen dismisses, game transitions to PLAYING
      game.handleTap({ x: 206, y: 500 });
      expect(game.state).toBe(STATE_PLAYING);
      expect(env.elements['start-screen'].classList.contains('hidden')).toBe(true);
      expect(game.sound.ctx).not.toBeNull();

      // Step 3: Player flips gravity rail with a tap
      const initialRail = game.player.currentRail;
      game.handleTap();
      expect(game.player.targetRail).not.toBe(initialRail);

      // Step 4: Player micro-steers laterally using thumb drag
      const startX = game.player.x;
      game.handleDrag({ x: 206, y: 500 }, { x: 15, y: 0 });
      expect(game.player.dragOffset).toBeGreaterThan(0);

      // Step 5: Player near-misses first obstacle, building 2x multiplier
      game.scoreManager.addNearMiss();
      expect(game.scoreManager.multiplier).toBe(2);

      // Step 6: Player crashes into hazard after earning 180 points
      game.score = 180;
      game.scoreManager.score = 180;
      game.triggerGameOver();

      expect(game.state).toBe(STATE_GAME_OVER);
      expect(env.elements['game-over-screen'].classList.contains('hidden')).toBe(false);
      expect(env.elements['game-over-score'].textContent).toBe('180');
      expect(env.elements['new-record-badge'].classList.contains('hidden')).toBe(false);
      expect(storage.getHighScore()).toBe(180);

      // Step 7: Player taps "PLAY AGAIN" -> instant restart with 0ms delay, preserving high score
      game.reset();
      game.startPlaying();

      expect(game.state).toBe(STATE_PLAYING);
      expect(game.score).toBe(0);
      expect(game.highScore).toBe(180);
      expect(env.elements['game-over-screen'].classList.contains('hidden')).toBe(true);
    });
  });

  // =========================================================================
  // Scenario 2: Friend Challenge Link Recipient (Viral Challenge Loop)
  // =========================================================================
  describe('Scenario 2: Friend Challenge Link Recipient (Viral Challenge Loop)', () => {
    it('receives SMS challenge link, beats target score, triggers victory fanfare, and sends revenge challenge', async () => {
      // Step 1: Open link with challenge URL ?c=1250&by=Alex
      env.cleanup();
      env = setupFullE2EEnvironment({ search: '?c=1250&by=Alex' });

      const game = new GameEngine(env.canvas);

      // Step 2: Challenge banner displays target and challenger name
      expect(game.scoreManager.challengeTarget).toBe(1250);
      const banner = env.elements['challenge-banner'];
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(env.elements['challenge-text'].textContent).toContain('Alex');
      expect(env.elements['challenge-text'].textContent).toContain('1,250');

      // Step 3: Player starts game and surpasses 1,250 target
      game.startPlaying();
      const fanfareSpy = vi.spyOn(game.sound, 'playFanfare');

      // Score crosses 1,250 target (e.g. 1,280)
      game.score = 1280;
      game.scoreManager.score = 1280;
      game.update(1 / 120);

      // Step 4: Milestone fanfare and celebration trigger
      expect(game.scoreManager.isChallengeBeaten).toBe(true);
      expect(fanfareSpy).toHaveBeenCalled();
      expect(env.elements['challenge-text'].textContent).toContain('Target Crushed');

      // Step 5: Player crashes at 1,480 points
      game.score = 1480;
      game.scoreManager.score = 1480;
      game.triggerGameOver();

      expect(env.elements['challenge-result-row'].classList.contains('hidden')).toBe(false);
      expect(env.elements['summary-challenge'].textContent).toContain('TARGET CRUSHED');

      // Step 6: Player taps "CHALLENGE FRIENDS" -> sends revenge link with new score 1480
      const shareResult = await game.share.shareScore({ score: 1480, playerName: 'Challenger' });
      expect(shareResult.success).toBe(true);
      expect(env.shareLog.length).toBe(1);
      const payload = env.shareLog[0];
      expect(payload.url).toContain('c=1480');
      expect(payload.text).toContain('1480');
    });
  });

  // =========================================================================
  // Scenario 3: Offline Subway Commuter (Zero-Network PWA Resilience)
  // =========================================================================
  describe('Scenario 3: Offline Subway Commuter (Zero-Network PWA Resilience)', () => {
    it('launches from home screen cache without network, plays full game loops, and copies offline share link', async () => {
      // Step 1: Simulate airplane mode (fetch disabled, network unavailable)
      delete global.fetch;

      const storage = new StorageController();
      const game = new GameEngine(env.canvas, { storageController: storage });

      // Step 2: Game boots completely from cached shell
      expect(game.state).toBe(STATE_START);
      game.startPlaying();
      expect(game.state).toBe(STATE_PLAYING);

      // Step 3: 120Hz physics loop and procedural audio synth function offline
      for (let i = 0; i < 120; i++) {
        game.update(1 / 120);
      }
      expect(game.player.y).toBe(650);

      // Step 4: Player earns high score offline
      game.score = 820;
      game.scoreManager.score = 820;
      game.triggerGameOver();

      expect(storage.getHighScore()).toBe(820);
      expect(env.elements['game-over-score'].textContent).toBe('820');

      // Step 5: Web Share unavailable offline or on desktop -> clipboard fallback copies challenge text
      delete env.navigator.share;
      const shareResult = await game.share.shareScore({ score: 820 });

      expect(shareResult.success).toBe(true);
      expect(shareResult.method).toBe('clipboard');
      expect(env.clipboardLog.length).toBe(1);
      expect(env.clipboardLog[0]).toContain('c=820');

      // Toast notification alerts commuter that link is ready to paste
      const toastContainer = env.elements['toast-container'];
      expect(toastContainer.children.length).toBeGreaterThan(0);
      expect(toastContainer.children[0].textContent).toContain('copied to clipboard');
    });
  });

  // =========================================================================
  // Scenario 4: High Score Champion (High-Score Defense & Celebration)
  // =========================================================================
  describe('Scenario 4: High Score Champion (High-Score Defense & Celebration)', () => {
    it('defends existing record across multiple runs, celebrates new record with fanfare, and shares bragging rights', async () => {
      const storage = new StorageController();
      storage.saveHighScore(2500);

      const game = new GameEngine(env.canvas, { storageController: storage });
      expect(game.highScore).toBe(2500);

      // Run 1: Champion dies at 1,200 points (below best)
      game.startPlaying();
      game.score = 1200;
      game.scoreManager.score = 1200;
      game.triggerGameOver();

      expect(env.elements['new-record-badge'].classList.contains('hidden')).toBe(true);
      expect(env.elements['game-over-score'].textContent).toBe('1200');
      expect(env.elements['game-over-best'].textContent).toBe('2500');
      expect(storage.getHighScore()).toBe(2500);

      // Replay Run 2
      game.reset();
      game.startPlaying();
      const fanfareSpy = vi.spyOn(game.sound, 'playFanfare');

      // Run 2: Champion survives extended marathon run, reaching 3,200 points!
      game.score = 3200;
      game.scoreManager.score = 3200;
      game.triggerGameOver();

      // Celebration triggers
      expect(env.elements['new-record-badge'].classList.contains('hidden')).toBe(false);
      expect(fanfareSpy).toHaveBeenCalled();
      expect(env.elements['game-over-score'].textContent).toBe('3200');
      expect(env.elements['game-over-best'].textContent).toBe('3200');
      expect(storage.getHighScore()).toBe(3200);

      // Champion shares new brag link
      await game.share.shareScore({ score: 3200, playerName: 'Champion' });
      expect(env.shareLog.length).toBe(1);
      const payload = env.shareLog[0];
      expect(payload.url).toContain('c=3200');
      expect(payload.url).toContain('by=Champion');
    });
  });
});
