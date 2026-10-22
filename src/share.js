/* ==========================================================================
   Social Share & Challenge URL Controller - AntiGravity: Neon Pulse
   Web Share API with Silent AbortError Suppression, Clipboard Fallback,
   Floating Animated Toast, and Strict XSS-Sanitized Challenge Query Parsing
   ========================================================================== */

/**
 * Strips HTML tags, escapes dangerous XSS entities, and truncates name to 20 characters.
 * @param {string} rawName
 * @returns {string} Sanitized name string
 */
export function sanitizeChallengerName(rawName) {
  if (typeof rawName !== 'string') {
    return 'Challenger';
  }

  // 1. Strip HTML tags completely
  let clean = rawName.replace(/<[^>]*>/g, '');

  // 2. Escape entities to prevent HTML interpretation in DOM
  clean = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // 3. Strip non-printable ASCII control characters
  clean = clean.replace(/[\x00-\x1F\x7F]/g, '');

  // 4. Trim whitespace and truncate to 20 characters
  clean = clean.trim().slice(0, 20);

  return clean.length > 0 ? clean : 'Challenger';
}

/**
 * Parses challenge query parameters from a search string or window.location.search.
 * Strictly bounds target score to positive integer (1 to 9,999,999) and sanitizes name.
 * @param {string} [searchString]
 * @returns {{ hasChallenge: boolean, targetScore: number|null, challengerName: string|null }}
 */
export function parseChallengeParams(searchString) {
  let query = searchString;

  if (typeof query === 'undefined') {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      query = window.location.search;
    } else {
      query = '';
    }
  }

  if (typeof query !== 'string' || query.trim() === '') {
    return { hasChallenge: false, targetScore: null, challengerName: null };
  }

  // Extract query portion if full URL was provided
  const queryIndex = query.indexOf('?');
  const cleanQuery = queryIndex !== -1 ? query.slice(queryIndex + 1) : query;

  try {
    const params = new URLSearchParams(cleanQuery);
    const rawScore = params.get('c') || params.get('score');
    const rawName = params.get('by') || params.get('challenger');

    if (!rawScore) {
      return { hasChallenge: false, targetScore: null, challengerName: null };
    }

    // Strict positive integer validation: reject floats, scientific notation, strings, <= 0
    const trimmedScore = String(rawScore).trim();
    if (!/^\d+$/.test(trimmedScore)) {
      return { hasChallenge: false, targetScore: null, challengerName: null };
    }

    const parsedScore = parseInt(trimmedScore, 10);
    if (!Number.isFinite(parsedScore) || parsedScore < 1 || parsedScore > 9999999) {
      return { hasChallenge: false, targetScore: null, challengerName: null };
    }

    const cleanName = sanitizeChallengerName(rawName);

    return {
      hasChallenge: true,
      targetScore: parsedScore,
      challengerName: cleanName
    };
  } catch (_) {
    return { hasChallenge: false, targetScore: null, challengerName: null };
  }
}

/**
 * Multi-tier Share Controller conforming to PROJECT.md and Milestone 3 specs.
 */
export class ShareController {
  constructor() {
    this._toastTimer = null;
  }

  /**
   * Generates a shareable challenge URL containing score and challenger name.
   * Format: https://.../?c=${score}&by=${encodeURIComponent(playerName)}
   * @param {number} score
   * @param {string} [playerName='Challenger']
   * @returns {string} Fully formed challenge URL
   */
  generateChallengeUrl(score, playerName = 'Challenger') {
    const numericScore = Math.max(1, Math.floor(Number(score) || 0));
    const cleanName = sanitizeChallengerName(playerName);

    let baseUrl = './index.html';
    if (typeof window !== 'undefined' && window.location) {
      const origin = window.location.origin;
      const pathname = window.location.pathname || '/';
      if (origin && origin !== 'null' && window.location.protocol !== 'file:') {
        baseUrl = `${origin}${pathname}`;
      } else {
        baseUrl = `${pathname}`;
      }
    }

    return `${baseUrl}?c=${numericScore}&by=${encodeURIComponent(cleanName)}`;
  }

  /**
   * Parses challenge URL search string.
   * @param {string} [urlSearchString]
   * @returns {{ hasChallenge: boolean, targetScore: number|null, challengerName: string|null }}
   */
  parseChallenge(urlSearchString) {
    return parseChallengeParams(urlSearchString);
  }

  /**
   * Static convenience helper for parseChallenge.
   */
  static parseChallenge(urlSearchString) {
    return parseChallengeParams(urlSearchString);
  }

  /**
   * Invokes Web Share API with silent AbortError suppression, falling back to Clipboard API + Toast.
   * @param {Object} payload
   * @param {number} payload.score
   * @param {string} [payload.playerName='Challenger']
   * @returns {Promise<{ success: boolean, method: string, cancelled?: boolean }>}
   */
  async shareScore({ score = 0, playerName = 'Challenger' } = {}) {
    const numericScore = Math.max(0, Math.floor(Number(score) || 0));
    const cleanName = sanitizeChallengerName(playerName);
    const url = this.generateChallengeUrl(numericScore, cleanName);

    const shareData = {
      title: 'AntiGravity: Neon Pulse',
      text: 'Can you beat my score of ' + numericScore + ' in AntiGravity?',
      url
    };

    // 1. Tier 1: Modern Web Share API
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return { success: true, method: 'web-share', cancelled: false };
      } catch (err) {
        // Traps and silently suppresses AbortError (when user dismisses native mobile share sheet)
        if (err && (err.name === 'AbortError' || err.code === 20)) {
          return { success: false, method: 'web-share', cancelled: true };
        }
        // If other error occurred, seamlessly proceed to clipboard fallback
      }
    }

    // 2. Tier 2: Modern Clipboard API Fallback
    let copied = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (_) {
        // Fallback to legacy execCommand
      }
    }

    // 3. Tier 3: Legacy execCommand Fallback
    if (!copied && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (_) {}
    }

    // 4. Render animated floating toast notification
    this.showToast('📋 Challenge link copied to clipboard!');

    return {
      success: copied,
      method: 'clipboard',
      cancelled: false
    };
  }

  /**
   * Renders a floating animated toast notification with auto-dismissal.
   * @param {string} message
   * @param {number} [durationMs=2500]
   * @returns {HTMLElement|null}
   */
  showToast(message, durationMs = 2500) {
    if (typeof document === 'undefined') {
      return null;
    }

    // Remove any currently existing toast
    const existing = document.getElementById('game-toast');
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'game-toast';
    toast.className = 'game-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;

    const shelf = document.getElementById('toast-container') || document.body;
    shelf.appendChild(toast);

    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }

    this._toastTimer = setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, durationMs);

    return toast;
  }
}
