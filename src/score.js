/* ==========================================================================
   Score & Storage Management - AntiGravity: Neon Pulse
   ScoreManager: Multipliers, Near-Miss Combos, Survival Tick Points, Target Detection
   StorageController: Resilient LocalStorage Persistence with In-Memory Fallback
   ========================================================================== */

export const STORAGE_KEY = 'antigravity_high_score';
export const DEFAULT_COMBO_DURATION = 2.5; // Seconds before multiplier decays
export const MAX_MULTIPLIER = 10;
export const POINTS_PER_NEAR_MISS = 50;
export const SURVIVAL_POINTS_PER_SEC = 10;

/**
 * Resilient localStorage controller with in-memory fallback.
 * Safely recovers from corrupted payloads, QuotaExceededError, and security exceptions.
 */
export class StorageController {
  /**
   * @param {Storage} [storage=null] - Optional custom storage implementation (defaults to window.localStorage)
   */
  constructor(storage = null) {
    this._customStorage = storage;
    this.inMemoryScore = 0;
  }

  /**
   * Safely resolves the active Storage provider.
   * @private
   * @returns {Storage|null}
   */
  _getStorage() {
    if (this._customStorage) {
      return this._customStorage;
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
      if (typeof localStorage !== 'undefined') {
        return localStorage;
      }
    } catch (_) {
      // SecurityError or restricted environment
    }
    return null;
  }

  /**
   * Reads and parses high score from persistent storage.
   * Returns in-memory fallback score if missing or corrupted.
   * @returns {number}
   */
  getHighScore() {
    const storage = this._getStorage();
    if (!storage) {
      return this.inMemoryScore;
    }

    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined || raw === '') {
        return this.inMemoryScore;
      }

      // Handle raw numeric or stringified integers
      const parsed = parseInt(String(raw).trim(), 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        this.inMemoryScore = Math.max(this.inMemoryScore, parsed);
        return this.inMemoryScore;
      }

      // If invalid / corrupted string (e.g. "NaN", "{bad: json}", "-120"), fallback safely
      return this.inMemoryScore;
    } catch (_) {
      // Storage access blocked or threw an error
      return this.inMemoryScore;
    }
  }

  /**
   * Persists a new high score to storage if it strictly exceeds previous record.
   * Fallback to in-memory storage if QuotaExceededError or security exception occurs.
   * @param {number} score
   * @returns {boolean} True if new high score was recorded
   */
  saveHighScore(score) {
    const numericScore = Math.floor(Number(score));
    if (!Number.isFinite(numericScore) || numericScore <= 0) {
      return false;
    }

    // Strictly monotonic: only update if score exceeds existing in-memory / storage record
    const currentHigh = this.getHighScore();
    if (numericScore <= currentHigh) {
      return false;
    }

    this.inMemoryScore = numericScore;

    const storage = this._getStorage();
    if (!storage) {
      return true; // Successfully saved in memory
    }

    try {
      storage.setItem(STORAGE_KEY, String(numericScore));
      return true;
    } catch (_) {
      // QuotaExceededError or private browsing limitation: in-memory fallback is already preserved
      return true;
    }
  }

  /**
   * Clears storage key (primarily for test harness isolation).
   */
  clearHighScore() {
    this.inMemoryScore = 0;
    const storage = this._getStorage();
    if (storage) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (_) {}
    }
  }
}

/**
 * Real-time gameplay score manager.
 * Tracks current score, combo multipliers, survival accumulation, and challenge goals.
 */
export class ScoreManager {
  /**
   * @param {Object} [options={}]
   * @param {StorageController} [options.storageController=null]
   * @param {number|null} [options.challengeTarget=null]
   * @param {number} [options.comboDuration=2.5]
   * @param {number} [options.maxMultiplier=10]
   * @param {number} [options.initialScore=0]
   */
  constructor(options = {}) {
    this.storage = options.storageController || new StorageController();
    this.challengeTarget = null;
    if (options.challengeTarget !== undefined && options.challengeTarget !== null) {
      this.setChallengeTarget(options.challengeTarget);
    }

    this.comboDuration = options.comboDuration || DEFAULT_COMBO_DURATION;
    this.maxMultiplier = options.maxMultiplier || MAX_MULTIPLIER;

    this.score = Math.max(0, Math.floor(Number(options.initialScore) || 0));
    this.multiplier = 1;
    this.comboTimer = 0;
    this.survivalAccumulator = 0;

    this.highScore = this.storage.getHighScore();
    this.isNewHighScore = false;
    this.isChallengeBeaten = false;
  }

  /**
   * Sets or updates active challenge target score.
   * @param {number|null} target
   */
  setChallengeTarget(target) {
    if (target === null || target === undefined) {
      this.challengeTarget = null;
      return;
    }
    const val = parseInt(String(target), 10);
    if (Number.isFinite(val) && val > 0) {
      this.challengeTarget = val;
      // If already started with a score exceeding target
      if (this.score > this.challengeTarget) {
        this.isChallengeBeaten = true;
      }
    } else {
      this.challengeTarget = null;
    }
  }

  /**
   * Registers a near-miss graze event.
   * Increments multiplier (capped at 10x), resets decay timer, and awards points.
   * @returns {number} Points awarded for this near miss
   */
  addNearMiss() {
    this.multiplier = Math.min(this.maxMultiplier, this.multiplier + 1);
    this.comboTimer = this.comboDuration;

    const points = POINTS_PER_NEAR_MISS * this.multiplier;
    this.score += points;
    this._checkMilestones();
    return points;
  }

  /**
   * Fixed physics/frame update for multiplier decay and continuous survival points.
   * Survival points: +10 * multiplier / second.
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    // 1. Combo multiplier decay timer
    if (this.multiplier > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.multiplier = 1;
        this.comboTimer = 0;
      }
    }

    // 2. Continuous survival accumulation (+10 * multiplier / sec)
    this.survivalAccumulator += SURVIVAL_POINTS_PER_SEC * this.multiplier * dt;
    if (this.survivalAccumulator >= 1) {
      const wholePoints = Math.floor(this.survivalAccumulator);
      this.score += wholePoints;
      this.survivalAccumulator -= wholePoints;
      this._checkMilestones();
    }
  }

  /**
   * Evaluates if current score exceeds high score or challenge target.
   * @private
   */
  _checkMilestones() {
    if (this.score > this.highScore) {
      this.isNewHighScore = true;
    }
    if (this.challengeTarget !== null && this.score > this.challengeTarget) {
      this.isChallengeBeaten = true;
    }
  }

  /**
   * Returns true if current score strictly beats the active challenge target.
   * @returns {boolean}
   */
  checkChallengeBeaten() {
    if (this.challengeTarget !== null && this.score > this.challengeTarget) {
      this.isChallengeBeaten = true;
      return true;
    }
    return false;
  }

  /**
   * Returns true if current score exceeds previous high score.
   * @returns {boolean}
   */
  checkHighScore() {
    return this.score > this.highScore;
  }

  /**
   * Commits the current score to persistent storage if it is a new high score.
   * @returns {boolean} True if new record was successfully saved
   */
  saveHighScore() {
    if (this.score > this.highScore) {
      const saved = this.storage.saveHighScore(this.score);
      this.highScore = this.score;
      this.isNewHighScore = true;
      return saved;
    }
    return false;
  }

  /**
   * Resets session score, combo multipliers, and session milestone flags.
   */
  reset() {
    this.score = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.survivalAccumulator = 0;
    this.isNewHighScore = false;
    this.isChallengeBeaten = false;
  }
}
