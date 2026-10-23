/* ==========================================================================
   UI Manager - AntiGravity: Neon Pulse
   HUD Overlay, Challenge Banners, Game-Over Modal, Share & Replay Buttons, Toasts
   ========================================================================== */

import { ShareController } from './share.js';

export class UIManager {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.soundEngine=null] - SoundEngine instance for fanfare
   * @param {ShareController} [options.shareController=null] - ShareController instance
   */
  constructor(options = {}) {
    this.soundEngine = options.soundEngine || null;
    this.shareController = options.shareController || new ShareController();
    this.targetCrushed = false;
    this._fanfarePlayed = false;

    // Value cache to avoid layout thrashing and redundant DOM mutations on 120Hz ticks
    this._lastScore = null;
    this._lastMultiplier = null;
    this._lastBest = null;

    // DOM references
    this.hudScore = null;
    this.hudMultiplier = null;
    this.hudBest = null;
    this.challengeBanner = null;
    this.challengeText = null;
    this.startScreen = null;
    this.gameOverScreen = null;
    this.gameOverScore = null;
    this.gameOverBest = null;
    this.newRecordBadge = null;
    this.challengeResultRow = null;
    this.summaryChallenge = null;
    this.btnShareScore = null;
    this.btnReplay = null;
    this.toastContainer = null;

    if (typeof document !== 'undefined') {
      this.bindDOM();
    }
  }

  /**
   * Discovers and binds all UI elements from document.
   * Tolerates both canonical Milestone 3 IDs and legacy index.html IDs.
   */
  bindDOM() {
    if (typeof document === 'undefined') return;

    // HUD Top Elements
    this.hudScore = document.getElementById('hud-score');
    this.hudMultiplier = document.getElementById('hud-multiplier');
    this.hudBest = document.getElementById('hud-best');

    // Challenge Banner
    this.challengeBanner = document.getElementById('challenge-banner');
    this.challengeText = document.getElementById('challenge-text');

    // Screens
    this.startScreen = document.getElementById('start-screen');
    this.gameOverScreen = document.getElementById('game-over-screen');

    // Game Over Summaries
    this.gameOverScore = document.getElementById('game-over-score') || document.getElementById('summary-score');
    this.gameOverBest = document.getElementById('game-over-best') || document.getElementById('summary-best');
    this.newRecordBadge = document.getElementById('new-record-badge');
    this.challengeResultRow = document.getElementById('challenge-result-row');
    this.summaryChallenge = document.getElementById('summary-challenge');

    // Action Buttons
    this.btnShareScore = document.getElementById('btn-share-score') || document.getElementById('btn-share');
    this.btnReplay = document.getElementById('btn-replay') || document.getElementById('btn-retry');

    // Toast Shelf
    this.toastContainer = document.getElementById('toast-container');

    // Legacy property aliases for backward-compatibility with tests / internal references
    this.summaryScore = this.gameOverScore;
    this.summaryBest = this.gameOverBest;
    this.btnRetry = this.btnReplay;
  }

  /**
   * Renders incoming challenger banner if URL contains valid challenge parameters.
   * Format: "🎯 Alex challenged you to beat 1,250!"
   * @param {{ targetScore: number, challengerName: string }} challenge
   */
  showChallengeBanner(challenge) {
    if (!challenge || !challenge.targetScore) return;

    const formattedTarget = Number(challenge.targetScore).toLocaleString();
    const challenger = challenge.challengerName || 'A friend';
    const message = `🎯 ${challenger} challenged you to beat ${formattedTarget}!`;

    if (this.challengeText) {
      this.challengeText.textContent = message;
    } else if (this.challengeBanner) {
      this.challengeBanner.textContent = message;
    }

    if (this.challengeBanner) {
      this.challengeBanner.classList.remove('hidden');
    }
  }

  /**
   * Triggers victory celebration when active challenge target score is surpassed.
   * Banner switches to "🏆 Target Crushed!" and plays fanfare audio.
   */
  triggerTargetCrushed() {
    if (this.targetCrushed) return;
    this.targetCrushed = true;

    if (this.challengeText) {
      this.challengeText.textContent = '🏆 Target Crushed!';
    } else if (this.challengeBanner) {
      this.challengeBanner.textContent = '🏆 Target Crushed!';
    }

    if (this.challengeBanner) {
      this.challengeBanner.classList.remove('hidden');
      this.challengeBanner.classList.add('target-crushed');
    }

    if (this.summaryChallenge) {
      this.summaryChallenge.textContent = 'TARGET CRUSHED!';
    }

    if (this.soundEngine && typeof this.soundEngine.playFanfare === 'function') {
      this.soundEngine.playFanfare();
      this._fanfarePlayed = true;
    }
  }

  /**
   * Updates real-time gameplay HUD elements.
   * Throttles DOM text writes strictly on value change to eradicate 120Hz thrashing.
   * @param {Object} state
   * @param {number} state.score
   * @param {number} state.multiplier
   * @param {number} state.best
   */
  updateHUD({ score = 0, multiplier = 1, best = 0 } = {}) {
    if (this.hudScore && this._lastScore !== score) {
      this.hudScore.textContent = String(score);
      this._lastScore = score;
    }
    if (this.hudMultiplier && this._lastMultiplier !== multiplier) {
      this.hudMultiplier.textContent = `${multiplier}x`;
      this._lastMultiplier = multiplier;
    }
    if (this.hudBest && this._lastBest !== best) {
      this.hudBest.textContent = String(best);
      this._lastBest = best;
    }
  }

  /**
   * Populates and reveals the Game Over modal screen.
   * @param {Object} details
   * @param {number} details.score
   * @param {number} details.highScore
   * @param {boolean} [details.isNewBest=false]
   * @param {boolean} [details.isChallengeBeaten=false]
   */
  showGameOver({ score = 0, highScore = 0, isNewBest = false, isChallengeBeaten = false } = {}) {
    if (this.gameOverScore) {
      this.gameOverScore.textContent = String(score);
    }
    if (this.gameOverBest) {
      this.gameOverBest.textContent = String(highScore);
    }

    if (this.newRecordBadge) {
      if (isNewBest) {
        this.newRecordBadge.classList.remove('hidden');
        if (!this._fanfarePlayed && this.soundEngine && typeof this.soundEngine.playFanfare === 'function') {
          this.soundEngine.playFanfare();
          this._fanfarePlayed = true;
        }
      } else {
        this.newRecordBadge.classList.add('hidden');
      }
    }

    if (this.challengeResultRow) {
      if (isChallengeBeaten) {
        this.challengeResultRow.classList.remove('hidden');
        if (this.summaryChallenge) {
          this.summaryChallenge.textContent = 'TARGET CRUSHED!';
        }
      } else {
        this.challengeResultRow.classList.add('hidden');
      }
    }

    if (this.gameOverScreen) {
      this.gameOverScreen.classList.remove('hidden');
    }
  }

  /**
   * Hides the Game Over modal.
   */
  hideGameOver() {
    if (this.gameOverScreen) {
      this.gameOverScreen.classList.add('hidden');
    }
    this._fanfarePlayed = false;
  }

  /**
   * Resets UI manager state between game rounds.
   */
  reset() {
    this._lastScore = null;
    this._lastMultiplier = null;
    this._lastBest = null;
    if (this.challengeResultRow) {
      this.challengeResultRow.classList.add('hidden');
    }
  }

  /**
   * Hides start screen overlay.
   */
  hideStartScreen() {
    if (this.startScreen) {
      this.startScreen.classList.add('hidden');
    }
  }

  /**
   * Shows start screen overlay.
   */
  showStartScreen() {
    if (this.startScreen) {
      this.startScreen.classList.remove('hidden');
    }
  }

  /**
   * Wires the share button to an action handler (or default ShareController).
   * @param {Function} handler
   */
  wireShareButton(handler) {
    const btn = this.btnShareScore || (typeof document !== 'undefined' ? document.getElementById('btn-share-score') || document.getElementById('btn-share') : null);
    if (!btn) return;

    btn.onclick = (e) => {
      e.stopPropagation();
      handler();
    };
  }

  /**
   * Wires the replay button to restart gameplay.
   * @param {Function} handler
   */
  wireReplayButton(handler) {
    const btn = this.btnReplay || (typeof document !== 'undefined' ? document.getElementById('btn-replay') || document.getElementById('btn-retry') : null);
    if (!btn) return;

    btn.onclick = (e) => {
      e.stopPropagation();
      handler();
    };
  }

  /**
   * Displays an animated toast message.
   * @param {string} message
   * @param {number} [duration=2500]
   */
  showToast(message, duration = 2500) {
    if (this.shareController && typeof this.shareController.showToast === 'function') {
      return this.shareController.showToast(message, duration);
    }
    return null;
  }
}
