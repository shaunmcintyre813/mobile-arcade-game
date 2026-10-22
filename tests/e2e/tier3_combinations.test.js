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

describe('Tier 3: Cross-Feature Integration Scenarios (Opaque-Box E2E)', () => {
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
  // Scenario 1: Play -> Near-Miss Multiplier -> Crash -> High Score Save
  // =========================================================================
  describe('Pairwise 1: Play -> Near-Miss Multiplier -> Crash -> High Score Save', () => {
    it('integrates full loop from start screen, near-miss accumulation, lethal crash, to persistent record', () => {
      const storage = new StorageController();
      storage.saveHighScore(200);

      const game = new GameEngine(env.canvas, { storageController: storage });
      expect(game.state).toBe(STATE_START);
      expect(game.highScore).toBe(200);

      // 1. User taps screen to launch game
      game.handleTap({ x: 200, y: 400 });
      expect(game.state).toBe(STATE_PLAYING);
      expect(env.elements['start-screen'].classList.contains('hidden')).toBe(true);

      // 2. Near-miss hazard grazes increment multiplier and score
      expect(game.scoreManager.multiplier).toBe(1);
      game.scoreManager.addNearMiss();
      expect(game.scoreManager.multiplier).toBe(2);
      expect(game.score).toBeGreaterThan(0);

      // Add second near-miss for 3x combo
      game.scoreManager.addNearMiss();
      expect(game.scoreManager.multiplier).toBe(3);

      // Simulate 1.5 seconds of survival under 3x multiplier
      game.scoreManager.comboTimer = 5.0;
      game.scoreManager.update(1.5);
      const scoreBeforeCrash = game.score;
      expect(scoreBeforeCrash).toBeGreaterThan(200);

      // 3. Lethal collision occurs
      const lethalHazard = { x: game.player.x, y: game.player.y, width: 30, height: 20 };
      game.triggerGameOver(lethalHazard);

      // 4. Assert game transitions to GAME_OVER and high score persists
      expect(game.state).toBe(STATE_GAME_OVER);
      expect(storage.getHighScore()).toBe(scoreBeforeCrash);
      expect(env.elements['game-over-screen'].classList.contains('hidden')).toBe(false);
      expect(env.elements['game-over-score'].textContent).toBe(String(scoreBeforeCrash));
      expect(env.elements['game-over-best'].textContent).toBe(String(scoreBeforeCrash));
      expect(env.elements['new-record-badge'].classList.contains('hidden')).toBe(false);
    });
  });

  // =========================================================================
  // Scenario 2: Open Challenge URL -> Challenge Banner -> Beat Target -> Fanfare -> Share
  // =========================================================================
  describe('Pairwise 2: Challenge Link Reception -> Target Defeated -> Revenge Share', () => {
    it('decodes incoming challenge, displays HUD banner, celebrates victory, and shares revenge link', async () => {
      // Simulate launching with ?c=500&by=Marcus
      env.cleanup();
      env = setupFullE2EEnvironment({ search: '?c=500&by=Marcus' });

      const game = new GameEngine(env.canvas);
      expect(game.scoreManager.challengeTarget).toBe(500);

      // 1. Assert challenge banner is displayed with challenger name and target
      const banner = env.elements['challenge-banner'];
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(env.elements['challenge-text'].textContent).toContain('Marcus');
      expect(env.elements['challenge-text'].textContent).toContain('500');

      // 2. Start run and accumulate score beyond 500
      game.startPlaying();
      const fanfareSpy = vi.spyOn(game.sound, 'playFanfare');

      // Reach 520 points
      game.score = 520;
      game.scoreManager.score = 520;
      game.update(1 / 120);

      // 3. Target crushed celebration triggered
      expect(game.scoreManager.isChallengeBeaten).toBe(true);
      expect(fanfareSpy).toHaveBeenCalled();
      expect(env.elements['challenge-text'].textContent).toContain('Target Crushed');

      // 4. Player dies at 750 points
      game.score = 750;
      game.scoreManager.score = 750;
      game.triggerGameOver();

      expect(env.elements['game-over-screen'].classList.contains('hidden')).toBe(false);
      expect(env.elements['challenge-result-row'].classList.contains('hidden')).toBe(false);
      expect(env.elements['summary-challenge'].textContent).toContain('TARGET CRUSHED');

      // 5. Click "CHALLENGE FRIENDS" sends revenge link with 750 points
      await game.share.shareScore({ score: 750, playerName: 'Challenger' });
      expect(env.shareLog.length).toBe(1);
      const sharePayload = env.shareLog[0];
      expect(sharePayload.url).toContain('c=750');
      expect(sharePayload.text).toContain('750');
    });
  });

  // =========================================================================
  // Scenario 3: Touch Unlock Audio -> Play Sounds -> Mute -> Game Restart
  // =========================================================================
  describe('Pairwise 3: Touch Unlock Audio -> Play Sounds -> Mute -> Game Restart', () => {
    it('unlocks Web Audio on first gesture, respects mute state, and survives game restarts', async () => {
      const sound = new SoundEngine();
      expect(sound.unlocked).toBe(false);

      // 1. First touch gesture triggers AudioContext unlock
      sound.ensureContext();
      await new Promise(r => setTimeout(r, 10));
      expect(sound.unlocked).toBe(true);
      expect(sound.ctx).not.toBeNull();
      expect(sound.ctx.state).toBe('running');

      // 2. Procedural sounds play without error
      expect(() => sound.playJump()).not.toThrow();
      expect(() => sound.playCombo(3)).not.toThrow();
      expect(() => sound.playCrash()).not.toThrow();

      // 3. User toggles mute
      sound.toggleMute(true);
      expect(sound.isMuted).toBe(true);

      // 4. Game restarts via engine reset and startPlaying
      const game = new GameEngine(env.canvas, { soundEngine: sound });
      game.startPlaying();
      expect(game.state).toBe(STATE_PLAYING);
      expect(game.sound.isMuted).toBe(true);

      // Tapping during play triggers flip without unhandled audio errors
      expect(() => game.handleTap()).not.toThrow();

      // Re-unmute restores audio
      sound.toggleMute(false);
      expect(sound.isMuted).toBe(false);
    });
  });

  // =========================================================================
  // Scenario 4: Dynamic Viewport Resize During Active Gameplay
  // =========================================================================
  describe('Pairwise 4: Dynamic Viewport Resize During Active Gameplay', () => {
    it('maintains virtual coordinates and entity bounds across live mid-game resize', () => {
      const display = new DisplayManager(env.canvas);
      const game = new GameEngine(env.canvas, { displayManager: display });
      game.startPlaying();

      // Initial portrait Galaxy S25 Ultra bounds
      const initialBounds = display.getVirtualBounds();
      expect(initialBounds.width).toBe(400);
      expect(initialBounds.height).toBeCloseTo(888.35, 1);

      // Player starts at left rail
      expect(game.player.x).toBe(RAIL_X_LEFT);

      // Mid-game resize to compact aspect ratio (360x640)
      env.canvas.clientWidth = 360;
      env.canvas.clientHeight = 640;
      env.window.innerWidth = 360;
      env.window.innerHeight = 640;
      display.resize();

      const resizedBounds = display.getVirtualBounds();
      expect(resizedBounds.width).toBe(400);
      expect(resizedBounds.height).toBeCloseTo(400 * (640 / 360), 2);

      // Step physics sub-step
      game.update(1 / 120);

      // Assert player position remains strictly valid within virtual coordinate system
      expect(Number.isFinite(game.player.x)).toBe(true);
      expect(Number.isFinite(game.player.y)).toBe(true);
      expect(game.player.x).toBeGreaterThanOrEqual(RAIL_X_LEFT - 40);
      expect(game.player.x).toBeLessThanOrEqual(RAIL_X_RIGHT + 40);

      // Flip gravity towards right rail post-resize
      game.handleTap();
      for (let i = 0; i < 60; i++) {
        game.player.update(1 / 120);
      }
      expect(game.player.x).toBeCloseTo(RAIL_X_RIGHT, 0);
    });
  });

  // =========================================================================
  // Scenario 5: Full Offline Session With Precached Assets
  // =========================================================================
  describe('Pairwise 5: Full Offline Session With Precached Assets', () => {
    it('verifies complete offline game boot, asset precaching, and challenge loop without network', async () => {
      // 1. Verify every precache asset exists physically on disk
      const swCode = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
      const match = swCode.match(/const PRECACHE_ASSETS = \[(.*?)\];/s);
      expect(match).toBeDefined();

      const assets = match[1]
        .split(',')
        .map(s => s.trim().replace(/['"]/g, ''))
        .filter(Boolean);

      expect(assets.length).toBeGreaterThanOrEqual(19);
      for (const a of assets) {
        const cleanPath = a.replace(/^\.\//, '');
        const fullPath = path.join(projectRoot, cleanPath === '' ? 'index.html' : cleanPath);
        expect(fs.existsSync(fullPath), `Precache asset ${a} must exist physically`).toBe(true);
      }

      // 2. Simulate offline navigation to challenge URL ?c=600&by=OfflineHero
      env.cleanup();
      env = setupFullE2EEnvironment({ search: '?c=600&by=OfflineHero' });

      // Simulate complete network disconnection
      delete global.fetch;

      // 3. Boot game engine in offline environment
      const storage = new StorageController();
      const game = new GameEngine(env.canvas, { storageController: storage });

      expect(game.scoreManager.challengeTarget).toBe(600);
      expect(env.elements['challenge-text'].textContent).toContain('OfflineHero');

      // 4. Play game and beat target offline
      game.startPlaying();
      game.score = 720;
      game.scoreManager.score = 720;
      game.update(1 / 120);

      expect(game.scoreManager.isChallengeBeaten).toBe(true);

      // 5. Crash and persist score to offline localStorage
      game.triggerGameOver();
      expect(storage.getHighScore()).toBe(720);
      expect(env.elements['game-over-score'].textContent).toBe('720');

      // 6. Share fallback writes challenge link to clipboard while offline
      delete env.navigator.share;
      const shareResult = await game.share.shareScore({ score: 720 });
      expect(shareResult.success).toBe(true);
      expect(shareResult.method).toBe('clipboard');
      expect(env.clipboardLog[0]).toContain('c=720');
    });
  });
});
