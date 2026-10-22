/* ==========================================================================
   GameEngine - AntiGravity: Neon Pulse
   Master Orchestrator, 120Hz Delta-Time Fixed Accumulator Loop & State Machine
   Seamless Integration of Viewport, Touch, Audio, Physics, and Visual FX
   ========================================================================== */

import { DisplayManager } from './display.js';
import { TouchController } from './touch.js';
import { SoundEngine } from './audio.js';
import { Player } from './player.js';
import { RailSystem } from './rails.js';
import { ObstacleManager } from './obstacles.js';
import { ParticleSystem } from './particles.js';
import { ScoreManager, StorageController } from './score.js';
import { ShareController } from './share.js';
import { UIManager } from './ui.js';

export const STATE_START = 'START';
export const STATE_PLAYING = 'PLAYING';
export const STATE_GAME_OVER = 'GAME_OVER';

export class GameEngine {
  /**
   * @param {HTMLCanvasElement} [canvas=null] - Target HTML canvas element
   * @param {Object} [options={}] - Custom subsystem overrides or config
   */
  constructor(canvas = null, options = {}) {
    this.canvas = canvas;
    this.options = options;

    // Fixed-timestep 120Hz accumulator configuration
    this.fixedTimeStep = 1 / 120; // 8.333ms sub-step
    this.maxAccumulator = 0.1; // 100ms clamp to protect against spiral of death
    this.accumulatedTime = 0;
    this.lastTime = 0;
    this.running = false;
    this.rafId = null;

    // Subsystem initialization
    this.display = options.displayManager || (this.canvas ? new DisplayManager(this.canvas) : null);
    this.sound = options.soundEngine || new SoundEngine();
    this.player = options.player || new Player();
    this.rails = options.railSystem || new RailSystem();
    this.obstacles = options.obstacleManager || new ObstacleManager();
    this.particles = options.particleSystem || new ParticleSystem();

    // State & Persistence subsystems
    this.storage = options.storageController || new StorageController();
    this.scoreManager = options.scoreManager || new ScoreManager({ storageController: this.storage });
    this.share = options.shareController || new ShareController();
    this.ui = options.uiManager || (typeof document !== 'undefined' ? new UIManager({ soundEngine: this.sound, shareController: this.share }) : null);

    // Game state
    this.state = STATE_START;
    this.totalTime = 0;
    this._challengeCelebrated = false;

    // Touch controller wiring
    this.touch = options.touchController || null;
    if (!this.touch && this.canvas) {
      this.touch = new TouchController(this.canvas, this.display, {
        onTap: (coords) => this.handleTap(coords),
        onDrag: (coords, delta) => this.handleDrag(coords, delta)
      });
    }

    if (this.ui) {
      this._bindDOM();
    }

    // Inspect URL for incoming challenge parameters on startup
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      const challenge = ShareController.parseChallenge(window.location.search);
      if (challenge && challenge.hasChallenge) {
        this.scoreManager.setChallengeTarget(challenge.targetScore);
        if (this.ui) {
          this.ui.showChallengeBanner(challenge);
        }
      }
    }
  }

  // Backward-compatible getters and setters delegating to ScoreManager
  get score() {
    return this.scoreManager ? this.scoreManager.score : 0;
  }
  set score(val) {
    if (this.scoreManager) this.scoreManager.score = val;
  }

  get comboMultiplier() {
    return this.scoreManager ? this.scoreManager.multiplier : 1;
  }
  set comboMultiplier(val) {
    if (this.scoreManager) this.scoreManager.multiplier = val;
  }

  get highScore() {
    return this.scoreManager ? this.scoreManager.highScore : 0;
  }
  set highScore(val) {
    if (this.scoreManager) this.scoreManager.highScore = val;
  }

  get comboTimer() {
    return this.scoreManager ? this.scoreManager.comboTimer : 0;
  }
  set comboTimer(val) {
    if (this.scoreManager) this.scoreManager.comboTimer = val;
  }

  get comboDuration() {
    return this.scoreManager ? this.scoreManager.comboDuration : 2.5;
  }
  set comboDuration(val) {
    if (this.scoreManager) this.scoreManager.comboDuration = val;
  }

  /**
   * Static factory method conforming to PROJECT.md interface contract.
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   * @returns {GameEngine}
   */
  static init(canvas, options = {}) {
    const engine = new GameEngine(canvas, options);
    return engine;
  }

  /**
   * Binds DOM UI elements, buttons, and listeners.
   * @private
   */
  _bindDOM() {
    if (!this.ui) return;

    if (typeof this.ui.bindDOM === 'function') {
      this.ui.bindDOM();
    }

    if (typeof this.ui.wireReplayButton === 'function') {
      this.ui.wireReplayButton(() => {
        this.reset();
        this.startPlaying();
      });
    }

    if (typeof this.ui.wireShareButton === 'function') {
      this.ui.wireShareButton(() => {
        this.share.shareScore({ score: this.scoreManager.score });
      });
    }

    if (this.ui.startScreen) {
      this.ui.startScreen.addEventListener('click', () => {
        if (this.state === STATE_START) {
          this.sound.ensureContext();
          this.startPlaying();
        }
      });
    }

    this.updateHUD();
  }

  /**
   * Starts game loop execution.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.tick(this.lastTime);
  }

  /**
   * Stops game loop execution.
   */
  stop() {
    this.running = false;
    if (this.rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Transitions from START/GAME_OVER to PLAYING.
   */
  startPlaying() {
    this.state = STATE_PLAYING;
    if (typeof window !== 'undefined' && window.AntiGravityAndroid &&
        typeof window.AntiGravityAndroid.setRoundState === 'function') {
      try { window.AntiGravityAndroid.setRoundState(true); } catch (_) {}
    }
    if (this.ui) {
      if (typeof this.ui.hideStartScreen === 'function') {
        this.ui.hideStartScreen();
      } else if (this.ui.startScreen) {
        this.ui.startScreen.classList.add('hidden');
      }
      if (typeof this.ui.hideGameOver === 'function') {
        this.ui.hideGameOver();
      } else if (this.ui.gameOverScreen) {
        this.ui.gameOverScreen.classList.add('hidden');
      }
    }
  }

  /**
   * Resets gameplay session state.
   */
  reset() {
    this.scoreManager.reset();
    this._challengeCelebrated = false;
    this.totalTime = 0;
    this.player.reset();
    this.obstacles.reset();
    this.particles.reset();
    this.updateHUD();
  }

  /**
   * Handles user tap input.
   * Inverts gravity during PLAYING or starts game during START.
   * @param {{ x: number, y: number }} [coords]
   */
  handleTap(coords) {
    if (this.state === STATE_START) {
      this.sound.ensureContext();
      this.startPlaying();
      return;
    }

    if (this.state === STATE_GAME_OVER) {
      return;
    }

    if (this.state === STATE_PLAYING) {
      this.player.flipGravity();
      this.sound.playJump();
      this.particles.spawnTrail(this.player.x, this.player.y, this.player.currentColor);
    }
  }

  /**
   * Handles user micro-drag input.
   * @param {{ x: number, y: number }} coords
   * @param {{ x: number, y: number }} delta
   */
  handleDrag(coords, delta) {
    if (this.state === STATE_PLAYING && delta && Number.isFinite(delta.x)) {
      this.player.applyMicroDrag(delta.x);
    }
  }

  /**
   * Master fixed-timestep accumulator game loop.
   * Guarantees 120Hz physics sub-stepping regardless of display refresh rate.
   * @param {number} currentTime
   */
  tick(currentTime) {
    if (!this.running) return;

    let delta = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    // Clamp delta to prevent "spiral of death" during frame drops / tab switches
    if (delta > this.maxAccumulator) {
      delta = this.maxAccumulator;
    }

    this.accumulatedTime += delta;

    // Fixed-timestep physics sub-stepping (120Hz = 8.333ms per step)
    while (this.accumulatedTime >= this.fixedTimeStep) {
      this.update(this.fixedTimeStep);
      this.accumulatedTime -= this.fixedTimeStep;
    }

    // Interpolation parameter alpha for render smoothing
    const alpha = this.accumulatedTime / this.fixedTimeStep;
    this.render(alpha);

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  /**
   * Synchronous fixed physics update.
   * @param {number} dt - Fixed delta time (1/120s)
   */
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    const bounds = this.display ? this.display.getVirtualBounds() : { width: 400, height: 900 };
    const virtualHeight = bounds.height;

    // Maintain clean input flow: reactive callbacks (onTap/onDrag) provide zero-latency input.
    // If a custom TouchController without callbacks is supplied, fall back to polling consumeInput().
    // Otherwise, cleanly drain buffered state to prevent duplicate input accumulation.
    if (this.touch && typeof this.touch.consumeInput === 'function') {
      const input = this.touch.consumeInput();
      const hasCallbacks = Boolean(this.touch.callbacks && (this.touch.callbacks.onTap || this.touch.callbacks.onDrag));
      if (!hasCallbacks) {
        if (input && input.flipGravity) {
          this.handleTap();
        }
        if (input && input.dragX !== 0) {
          this.player.applyMicroDrag(input.dragX);
        }
      }
    }

    // Update visuals & audio decay in all states
    this.particles.update(dt);
    this.rails.update(dt, this.state === STATE_PLAYING ? this.obstacles.currentSpeed : 120, virtualHeight);

    if (this.state !== STATE_PLAYING) {
      return;
    }

    this.totalTime += dt;

    // 1. Update player physics
    this.player.update(dt);

    // 2. Update obstacles and procedural generation
    this.obstacles.update(dt, virtualHeight);

    // 3. Collision evaluation (lethal vs near-miss graze margin)
    const collisions = this.obstacles.checkCollisions(this.player);

    if (collisions.lethal) {
      this.triggerGameOver(collisions.lethalObstacle);
      return;
    }

    // Process near-miss grazes (+20px margin)
    if (collisions.nearMisses.length > 0) {
      for (const obs of collisions.nearMisses) {
        this.scoreManager.addNearMiss();

        // Visual and auditory gratification
        this.sound.playNearMiss();
        this.sound.playCombo(this.scoreManager.multiplier);
        this.particles.spawnNearMiss(this.player.x, this.player.y);
      }
      this.updateHUD();
    }

    // Update score manager for combo decay and continuous survival points (+10 * multiplier / sec)
    this.scoreManager.update(dt);

    // Active challenge milestone evaluation during gameplay
    if (this.scoreManager.checkChallengeBeaten() && !this._challengeCelebrated) {
      this._challengeCelebrated = true;
      if (this.ui && typeof this.ui.triggerTargetCrushed === 'function') {
        this.ui.triggerTargetCrushed();
      } else {
        this.sound.playFanfare();
      }
    }

    this.updateHUD();
  }

  /**
   * Catastrophic game-over sequence.
   * @param {Object} [lethalObstacle]
   */
  triggerGameOver(lethalObstacle) {
    this.state = STATE_GAME_OVER;
    if (typeof window !== 'undefined' && window.AntiGravityAndroid) {
      if (typeof window.AntiGravityAndroid.setRoundState === 'function') {
        try { window.AntiGravityAndroid.setRoundState(false); } catch (_) {}
      }
      if (typeof window.AntiGravityAndroid.reportScore === 'function') {
        try { window.AntiGravityAndroid.reportScore(this.scoreManager.score); } catch (_) {}
      }
    }

    // Visual shockwave explosion and audio crash
    this.particles.spawnExplosion(this.player.x, this.player.y);
    this.sound.playCrash();

    // Check & persist high score
    const isNewBest = this.scoreManager.saveHighScore();

    // Show Game Over UI screen
    if (this.ui) {
      if (typeof this.ui.showGameOver === 'function') {
        this.ui.showGameOver({
          score: this.scoreManager.score,
          highScore: this.scoreManager.highScore,
          isNewBest,
          isChallengeBeaten: this.scoreManager.isChallengeBeaten
        });
        if (typeof this.ui.wireShareButton === 'function') {
          this.ui.wireShareButton(() => {
            this.share.shareScore({ score: this.scoreManager.score });
          });
        }
      } else if (this.ui.gameOverScreen) {
        if (this.ui.summaryScore) this.ui.summaryScore.textContent = String(this.scoreManager.score);
        if (this.ui.summaryBest) this.ui.summaryBest.textContent = String(this.scoreManager.highScore);
        const newRecordBadge = document.getElementById('new-record-badge');
        if (newRecordBadge) {
          if (isNewBest) {
            newRecordBadge.classList.remove('hidden');
            this.sound.playFanfare();
          } else {
            newRecordBadge.classList.add('hidden');
          }
        }
        this.ui.gameOverScreen.classList.remove('hidden');
      }
    }
  }

  /**
   * Updates HUD DOM elements with latest game values.
   */
  updateHUD() {
    if (this.ui) {
      if (typeof this.ui.updateHUD === 'function') {
        this.ui.updateHUD({
          score: this.scoreManager.score,
          multiplier: this.scoreManager.multiplier,
          best: this.scoreManager.highScore
        });
      } else {
        if (this.ui.hudScore) this.ui.hudScore.textContent = String(this.scoreManager.score);
        if (this.ui.hudMultiplier) this.ui.hudMultiplier.textContent = `${this.scoreManager.multiplier}x`;
        if (this.ui.hudBest) this.ui.hudBest.textContent = String(this.scoreManager.highScore);
      }
    }
  }

  /**
   * Main rendering pipeline.
   * @param {number} [alpha=1] - Accumulator interpolation factor
   */
  render(alpha = 1) {
    const ctx = this.display && this.display.ctx ? this.display.ctx : null;
    if (!ctx) return;

    const bounds = this.display.getVirtualBounds();
    const vw = bounds.width;
    const vh = bounds.height;

    ctx.save();

    // 1. Clear background with deep AMOLED cyber void (#050508)
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, vw, vh);

    // 2. Apply camera trauma screen shake
    this.particles.applyShake(ctx, vw / 2, vh / 2);

    // 3. Render twin rails, perspective grid & speed lines
    this.rails.render(ctx, vw, vh, this.state === STATE_PLAYING ? this.obstacles.currentSpeed : 120);

    // 4. Render active obstacles
    this.obstacles.render(ctx);

    // 5. Render player ship (if not dead in GAME_OVER)
    if (this.state !== STATE_GAME_OVER) {
      this.player.render(ctx);
    }

    // 6. Render additive particle FX
    this.particles.render(ctx);

    ctx.restore();
  }

  /**
   * Clean up resources and event listeners.
   */
  destroy() {
    this.stop();
    if (this.touch && typeof this.touch.destroy === 'function') {
      this.touch.destroy();
    }
    if (this.display && typeof this.display.destroy === 'function') {
      this.display.destroy();
    }
  }
}
