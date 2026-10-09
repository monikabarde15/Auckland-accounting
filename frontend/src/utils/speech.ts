// Speech Synthesis (TTS) and Speech-to-Text (STT) Service
import { VoiceProfile } from '../types';

export interface SpeechOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
  voiceProfileId?: string;
  audioUrl?: string;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}

export const AVAILABLE_VOICE_PROFILES: VoiceProfile[] = [
  {
    id: 'aria-nz',
    name: 'Aria (New Zealand Female)',
    region: 'Auckland, New Zealand',
    accent: 'NZ / Kiwi Professional Natural',
    description: 'Crisp, warm, and natural conversational delivery with authentic New Zealand cadence.',
    gender: 'female',
    isDefault: true
  },
  {
    id: 'molly-nz',
    name: 'Molly (Auckland Natural Kiwi)',
    region: 'Waitakere, New Zealand',
    accent: 'Aotearoa Colloquial & Business',
    description: 'Approachable and friendly Kiwi enunciation for client compliance reminders.',
    gender: 'female'
  },
  {
    id: 'natasha-au',
    name: 'Natasha (Australasia Natural)',
    region: 'Sydney / Australasia',
    accent: 'Oceania Commercial Standard',
    description: 'Authoritative, calm financial advisory tone for high-balance collections.',
    gender: 'female'
  },
  {
    id: 'hazel-uk',
    name: 'Hazel (British Business RP)',
    region: 'United Kingdom',
    accent: 'Received Pronunciation Formal',
    description: 'Formal, precise articulation suitable for corporate audit authorizations.',
    gender: 'female'
  },
  {
    id: 'mitchell-nz',
    name: 'Mitchell (New Zealand Male)',
    region: 'Wellington, New Zealand',
    accent: 'NZ Corporate Executive',
    description: 'Deep, clear male voice for senior partner escalations and callbacks.',
    gender: 'male'
  },
  {
    id: 'aditi-in',
    name: 'Aditi (Indian English & Hindi)',
    region: 'India / New Delhi',
    accent: 'Indian Professional Clear',
    description: 'Natural bilingual Indian accent optimized for Indian recipients & Hindi IVR.',
    gender: 'female'
  }
];

// Pre-synthesized studio-grade neural voice clips (exact high-fidelity Aria / Molly NZ audio)
const PRE_RENDERED_AUDIO_CLIPS: Record<string, string> = {
  itr_main: '/audio/itr_main_prompt.mp3',
  itr_transfer: '/audio/itr_opt1_transfer.mp3',
  itr_whatsapp: '/audio/itr_opt2_whatsapp.mp3',
  itr_filed: '/audio/itr_opt3_filed.mp3',
  gst_q1: '/audio/gst_q1.mp3',
  gst_q2: '/audio/gst_q2.mp3',
  gst_transfer: '/audio/gst_transfer.mp3',
  gst_complete: '/audio/gst_complete.mp3',
  nps_q1: '/audio/nps_q1.mp3'
};

class SpeechService {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private selectedVoiceId: string = 'aria-nz';

  constructor() {
    if (typeof window !== 'undefined') {
      if ('speechSynthesis' in window) {
        this.synth = window.speechSynthesis;
        this.loadVoices();
        if (this.synth.onvoiceschanged !== undefined) {
          this.synth.onvoiceschanged = () => this.loadVoices();
        }
      }
    }
  }

  private loadVoices() {
    if (this.synth) {
      this.cachedVoices = this.synth.getVoices();
    }
  }

  public getAvailableVoices(): VoiceProfile[] {
    return AVAILABLE_VOICE_PROFILES;
  }

  public getSelectedVoiceId(): string {
    return this.selectedVoiceId;
  }

  public setSelectedVoiceId(voiceId: string) {
    this.selectedVoiceId = voiceId;
  }

  public getSelectedVoiceProfile(): VoiceProfile {
    return (
      AVAILABLE_VOICE_PROFILES.find((v) => v.id === this.selectedVoiceId) ||
      AVAILABLE_VOICE_PROFILES[0]
    );
  }

  // Check if text matches pre-rendered studio neural audio
  private findMatchingAudioClip(text: string, customAudioUrl?: string): string | null {
    if (customAudioUrl) return customAudioUrl;
    const lower = text.toLowerCase();
    if (lower.includes('upcoming gst filing due on the 28th')) {
      return PRE_RENDERED_AUDIO_CLIPS.gst_q1;
    }
    if (lower.includes('fully reconciled in xero or myob')) {
      return PRE_RENDERED_AUDIO_CLIPS.gst_q2;
    }
    if (lower.includes('henderson office on semillon')) {
      return PRE_RENDERED_AUDIO_CLIPS.gst_transfer;
    }
    if (lower.includes('instructions have been logged and a confirmation email')) {
      return PRE_RENDERED_AUDIO_CLIPS.gst_complete;
    }
    if (lower.includes('on a scale of 1 to 5') && lower.includes('satisfied')) {
      return PRE_RENDERED_AUDIO_CLIPS.nps_q1;
    }
    return null;
  }

  speak(text: string, options: SpeechOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      this.stop();

      // Check if we have studio-quality pre-rendered Neural Audio
      const audioSrc = this.findMatchingAudioClip(text, options.audioUrl);

      if (audioSrc) {
        try {
          const audio = new Audio(audioSrc);
          this.currentAudio = audio;
          audio.volume = options.volume ?? 1.0;
          
          audio.onended = () => {
            this.currentAudio = null;
            options.onEnd?.();
            resolve();
          };

          audio.onerror = () => {
            this.currentAudio = null;
            // Fall back to Web Speech API if audio fails to load
            this.speakWithSynthesis(text, options, resolve);
          };

          audio.play().catch(() => {
            // If autoplay was blocked or user gesture required, fallback to synthesis
            this.speakWithSynthesis(text, options, resolve);
          });
          return;
        } catch {
          // Fall back to synthesis
        }
      }

      this.speakWithSynthesis(text, options, resolve);
    });
  }

  private speakWithSynthesis(
    text: string,
    options: SpeechOptions,
    resolve: () => void
  ) {
    if (!this.synth) {
      const duration = Math.min(Math.max(text.length * 55, 1500), 5000);
      setTimeout(() => {
        options.onEnd?.();
        resolve();
      }, duration);
      return;
    }

    const cleanText = text.replace(/\{(\w+)\}/g, '$1');
    const utterance = new SpeechSynthesisUtterance(cleanText);

    const hasHindi = /[\u0900-\u097F]/.test(cleanText) || /\b(namaste|shukriya|dhanyavaad|kripya|aapka|alvida)\b/i.test(cleanText);
    utterance.rate = options.rate ?? 0.95;
    utterance.pitch = options.pitch ?? 1.01;
    utterance.volume = options.volume ?? 1.0;
    utterance.lang = options.lang || (hasHindi ? 'hi-IN' : 'en-NZ');

    if (this.cachedVoices.length === 0) {
      this.loadVoices();
    }

    let voice: SpeechSynthesisVoice | undefined = undefined;
    if (hasHindi) {
      voice = this.cachedVoices.find((v) => v.lang.startsWith('hi') || v.name.toLowerCase().includes('hindi') || v.name.toLowerCase().includes('india'));
    }
    if (!voice) {
      voice = this.findBestVoice(options.voiceProfileId || this.selectedVoiceId);
    }
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => {
      this.currentUtterance = null;
      options.onEnd?.();
      resolve();
    };

    utterance.onerror = (e) => {
      this.currentUtterance = null;
      options.onError?.(e);
      resolve();
    };

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  private findBestVoice(voiceProfileId: string): SpeechSynthesisVoice | undefined {
    const voices = this.cachedVoices;
    if (!voices || voices.length === 0) return undefined;

    // Prioritize Aditi IN / Indian English / Hindi
    if (voiceProfileId === 'aditi-in') {
      const inMatch = voices.find((v) => v.lang === 'en-IN' || v.lang.startsWith('hi') || v.name.toLowerCase().includes('india') || v.name.toLowerCase().includes('hindi') || v.name.toLowerCase().includes('aditi'));
      if (inMatch) return inMatch;
    }

    // 1. Prioritize Aria (Natural / Neural)
    if (voiceProfileId === 'aria-nz' || !voiceProfileId) {
      const ariaMatch = voices.find((v) => {
        const name = v.name.toLowerCase();
        return name.includes('aria') || (name.includes('natural') && (v.lang === 'en-US' || v.lang === 'en-NZ'));
      });
      if (ariaMatch) return ariaMatch;

      // New Zealand native voice
      const nzMatch = voices.find((v) => v.lang === 'en-NZ' || v.name.toLowerCase().includes('new zealand') || v.name.toLowerCase().includes('molly'));
      if (nzMatch) return nzMatch;

      // Australian / Commonwealth natural female
      const auMatch = voices.find((v) => (v.lang === 'en-AU' || v.name.toLowerCase().includes('australia')) && !v.name.toLowerCase().includes('male'));
      if (auMatch) return auMatch;

      // Google UK English Female / Serena / Sonia
      const ukFemale = voices.find((v) => {
        const n = v.name.toLowerCase();
        return (n.includes('uk english female') || n.includes('serena') || n.includes('sonia') || n.includes('hazel')) && !n.includes('male');
      });
      if (ukFemale) return ukFemale;
    }

    // 2. Prioritize Molly NZ
    if (voiceProfileId === 'molly-nz') {
      const molly = voices.find((v) => v.name.toLowerCase().includes('molly') || v.lang === 'en-NZ');
      if (molly) return molly;
    }

    // 3. Prioritize Natasha AU
    if (voiceProfileId === 'natasha-au') {
      const natasha = voices.find((v) => v.name.toLowerCase().includes('natasha') || v.lang === 'en-AU');
      if (natasha) return natasha;
    }

    // 4. Prioritize Hazel UK
    if (voiceProfileId === 'hazel-uk') {
      const hazel = voices.find((v) => v.name.toLowerCase().includes('hazel') || v.name.toLowerCase().includes('sonia') || v.lang === 'en-GB');
      if (hazel) return hazel;
    }

    // General fallback: any English female voice or first English voice
    return (
      voices.find((v) => v.lang.startsWith('en') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('natural'))) ||
      voices.find((v) => v.lang === 'en-NZ') ||
      voices.find((v) => v.lang === 'en-AU') ||
      voices.find((v) => v.lang === 'en-GB') ||
      voices.find((v) => v.lang.startsWith('en'))
    );
  }

  playVoiceSample(voiceProfileId: string = 'aria-nz'): Promise<void> {
    return this.speak(
      'Kia Ora, this is an automated call from Auckland Accounting Services regarding your GST filing confirmation.',
      {
        voiceProfileId
      }
    );
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.currentUtterance) {
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
      this.currentUtterance = null;
    }
    if (this.synth) {
      this.synth.cancel();
    }
  }

  isSpeaking(): boolean {
    return (
      (!!this.currentAudio && !this.currentAudio.paused) ||
      (!!this.synth && this.synth.speaking)
    );
  }
}

export const speechService = new SpeechService();

// Speech Recognition (STT)
export function createSpeechRecognizer(
  onResult: (transcript: string) => void,
  onError?: (err: unknown) => void
): { start: () => void; stop: () => void; isSupported: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return {
      start: () => {},
      stop: () => {},
      isSupported: false,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognitionInstance: any = null;

  try {
    recognitionInstance = new SpeechRecognition();
    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = false;
    recognitionInstance.lang = 'en-NZ';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognitionInstance.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript.trim().toLowerCase());
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognitionInstance.onerror = (event: any) => {
      onError?.(event.error);
    };
  } catch (err) {
    onError?.(err);
  }

  return {
    start: () => {
      try {
        recognitionInstance?.start();
      } catch {
        // already started or busy
      }
    },
    stop: () => {
      try {
        recognitionInstance?.stop();
      } catch {
        // already stopped
      }
    },
    isSupported: !!recognitionInstance,
  };
}
