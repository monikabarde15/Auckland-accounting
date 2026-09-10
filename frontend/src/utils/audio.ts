// Web Audio API DTMF and Telephony Tone Synthesizer

class PhoneAudioEngine {
  private audioCtx: AudioContext | null = null;
  private currentOscillators: OscillatorNode[] = [];
  private ringInterval: number | null = null;

  private getContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // DTMF Standard Frequency Table
  // Rows: 697, 770, 852, 941 Hz
  // Cols: 1209, 1336, 1477, 1633 Hz
  private dtmfFrequencies: Record<string, [number, number]> = {
    '1': [697, 1209],
    '2': [697, 1336],
    '3': [697, 1477],
    '4': [770, 1209],
    '5': [770, 1336],
    '6': [770, 1477],
    '7': [852, 1209],
    '8': [852, 1336],
    '9': [852, 1477],
    '*': [941, 1209],
    '0': [941, 1336],
    '#': [941, 1477],
  };

  playDtmfTone(key: string, durationMs: number = 180): void {
    const freqs = this.dtmfFrequencies[key];
    if (!freqs) return;

    try {
      const ctx = this.getContext();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freqs[0], ctx.currentTime);
      osc2.frequency.setValueAtTime(freqs[1], ctx.currentTime);

      const volume = 0.2;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
      gain.gain.setValueAtTime(volume, ctx.currentTime + (durationMs / 1000) - 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + (durationMs / 1000));

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();

      osc1.stop(ctx.currentTime + (durationMs / 1000));
      osc2.stop(ctx.currentTime + (durationMs / 1000));
    } catch {
      // Audio context might be restricted before user gesture
    }
  }

  // NZ / International Ringback tone (400Hz + 450Hz cadence)
  startRingbackTone(): void {
    this.stopRingtone();
    try {
      const ctx = this.getContext();

      const playBurst = () => {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.value = 400;
        osc2.frequency.value = 450;

        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.setValueAtTime(0.08, now + 0.4);
        gain.gain.setValueAtTime(0, now + 0.41);
        gain.gain.setValueAtTime(0.08, now + 0.6);
        gain.gain.setValueAtTime(0.08, now + 1.0);
        gain.gain.setValueAtTime(0, now + 1.01);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.02);
        osc2.stop(now + 1.02);
      };

      playBurst();
      this.ringInterval = window.setInterval(playBurst, 3000);
    } catch {
      // Audio context error handling
    }
  }

  stopRingtone(): void {
    if (this.ringInterval !== null) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    this.currentOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // ignore
      }
    });
    this.currentOscillators = [];
  }

  playCallConnectedChime(): void {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {
      // ignore
    }
  }

  playHangupTone(): void {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(425, ctx.currentTime);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // ignore
    }
  }
}

export const phoneAudio = new PhoneAudioEngine();
