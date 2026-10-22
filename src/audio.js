/* ==========================================================================
   SoundEngine - AntiGravity: Neon Pulse
   100% Procedural Web Audio API Sound Synthesizer
   Zero External Assets, Ultra-Low Latency (<5ms), Mobile Autoplay Unlock
   ========================================================================== */

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.isMuted = false;
    this.unlocked = false;

    // Attach unlock handlers on first user gesture
    this._unlockHandler = () => this.ensureContext();
    if (typeof window !== 'undefined') {
      window.addEventListener('touchstart', this._unlockHandler, { passive: true, once: true });
      window.addEventListener('pointerdown', this._unlockHandler, { passive: true, once: true });
      window.addEventListener('click', this._unlockHandler, { passive: true, once: true });
    }
  }

  /**
   * Static factory method conforming to PROJECT.md interface contract.
   * @returns {SoundEngine}
   */
  static init() {
    const engine = new SoundEngine();
    engine.ensureContext();
    return engine;
  }

  /**
   * Initializes or resumes AudioContext upon user gesture.
   */
  ensureContext() {
    if (this.unlocked && this.ctx && this.ctx.state === 'running') {
      return this.ctx;
    }

    try {
      const AudioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!AudioCtx) {
        return null;
      }

      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.3, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
        this.createNoiseBuffer();
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.unlocked = true;
        }).catch(() => {});
      } else {
        this.unlocked = true;
      }

      return this.ctx;
    } catch (e) {
      console.warn('[SoundEngine] AudioContext initialization failed:', e);
      return null;
    }
  }

  /**
   * Pre-allocates a reusable 1-second white noise buffer.
   */
  createNoiseBuffer() {
    if (!this.ctx) return;
    try {
      const bufferSize = Math.floor(this.ctx.sampleRate * 1.0);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    } catch (e) {
      console.warn('[SoundEngine] Failed to create noise buffer:', e);
    }
  }

  /**
   * Toggles master mute state.
   * @param {boolean} [forceState]
   * @returns {boolean} New mute state
   */
  toggleMute(forceState) {
    this.isMuted = typeof forceState === 'boolean' ? forceState : !this.isMuted;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.3, now);
    }
    return this.isMuted;
  }

  /**
   * Gravity Flip / Rail Jump: Rising frequency sweep (140Hz -> 520Hz over 80ms)
   */
  playJump() {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.08);

      gain.gain.setValueAtTime(0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {
      console.warn('[SoundEngine] playJump error:', e);
    }
  }

  /**
   * Energy Pickup / Harmonic Combo Chime: Pentatonic chime transposed by combo count.
   * Base note C6 (1046.5 Hz), pentatonic steps [0, 4, 7, 9, 12, 16...]
   * @param {number} [comboCount=1]
   */
  playCombo(comboCount = 1) {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const safeCombo = Number.isFinite(comboCount) ? Math.floor(comboCount) : 1;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Pentatonic scale semitone offsets: C, E, G, A, C', E', G'...
      const pentatonic = [0, 4, 7, 9, 12, 16, 19, 21, 24];
      const stepIndex = Math.min(Math.max(0, safeCombo - 1), pentatonic.length - 1);
      const semitones = pentatonic[stepIndex];
      const baseFreq = 1046.5; // C6
      const freq = baseFreq * Math.pow(2, semitones / 12);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.7, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };

      osc.start(now);
      osc.stop(now + 0.14);
    } catch (e) {
      console.warn('[SoundEngine] playCombo error:', e);
    }
  }

  /**
   * Near-Miss Hypercharge: Resonant bandpass noise sweep (Doppler whoosh)
   */
  playNearMiss() {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    try {
      const now = ctx.currentTime;
      const noise = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      noise.buffer = this.noiseBuffer;
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(7.0, now);
      filter.frequency.setValueAtTime(350, now);
      filter.frequency.exponentialRampToValueAtTime(2200, now + 0.15);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.9, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noise.onended = () => {
        try {
          noise.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch (_) {}
      };

      noise.start(now);
      noise.stop(now + 0.15);
    } catch (e) {
      console.warn('[SoundEngine] playNearMiss error:', e);
    }
  }

  /**
   * Player Crash / Destruction: Dual-layer explosion (detuned sawtooth + lowpass noise)
   */
  playCrash() {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Layer 1: Detuned low bass punch
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(25, now + 0.5);

      oscGain.gain.setValueAtTime(0.9, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);

      osc.onended = () => {
        try {
          osc.disconnect();
          oscGain.disconnect();
        } catch (_) {}
      };

      osc.start(now);
      osc.stop(now + 0.5);

      // Layer 2: Decaying filtered white noise burst
      if (this.noiseBuffer) {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const noiseGain = ctx.createGain();

        noise.buffer = this.noiseBuffer;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(40, now + 0.65);

        noiseGain.gain.setValueAtTime(1.0, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.onended = () => {
          try {
            noise.disconnect();
            filter.disconnect();
            noiseGain.disconnect();
          } catch (_) {}
        };

        noise.start(now);
        noise.stop(now + 0.65);
      }
    } catch (e) {
      console.warn('[SoundEngine] playCrash error:', e);
    }
  }

  /**
   * High Score / Challenge Fanfare: Celebratory 4-note ascending synth brass arpeggio
   * Notes: C5 (523.25), G5 (783.99), C6 (1046.5), E6 (1318.51)
   */
  playFanfare() {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 783.99, 1046.5, 1318.51];
      const noteDuration = 0.12;

      notes.forEach((freq, idx) => {
        const noteStart = now + idx * noteDuration;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, noteStart);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2800, noteStart);
        filter.frequency.exponentialRampToValueAtTime(800, noteStart + noteDuration);

        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.linearRampToValueAtTime(0.6, noteStart + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDuration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.onended = () => {
          try {
            osc.disconnect();
            filter.disconnect();
            gain.disconnect();
          } catch (_) {}
        };

        osc.start(noteStart);
        osc.stop(noteStart + noteDuration);
      });
    } catch (e) {
      console.warn('[SoundEngine] playFanfare error:', e);
    }
  }
}
