import { useCallback, useEffect, useRef, useState } from 'react';
import { speakWithLocalVoice } from '../lib/api';

// Extracted unchanged from JarvisPersonalPage.tsx (2026-08-30) so the Home G
// voice control can reuse the exact same TTS behavior — same Kokoro speed,
// same fallback order, same anti-echo/interruption semantics.
const HERMES_KOKORO_SPEED = 1.12;

export type VoiceEngine = 'none' | 'kokoro' | 'piper' | 'espeak' | 'browser';
export type VoiceDiagnosticLevel = 'info' | 'warn' | 'error';

export type SpeakResult = {
  engine: VoiceEngine;
  usedLocalVoice: boolean;
  localFailure: boolean;
  error?: string;
  cancelled?: boolean;
};

export type SpeakerCallbacks = {
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
  onInterrupted?: () => void;
  onDiagnostic?: (message: string, level?: VoiceDiagnosticLevel) => void;
};

export type StopSpeakingOptions = {
  silent?: boolean;
};

export function useHermesSpeaker(callbacks?: SpeakerCallbacks) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastEngine, setLastEngine] = useState<VoiceEngine>('none');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callbacksRef = useRef<SpeakerCallbacks | undefined>(callbacks);
  const speakingActiveRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const mediaPrimedRef = useRef(false);
  const mediaPrimePromiseRef = useRef<Promise<boolean> | null>(null);
  const SILENT_AUDIO_DATA_URI =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const markSpeakStart = useCallback(() => {
    if (speakingActiveRef.current) return;
    speakingActiveRef.current = true;
    callbacksRef.current?.onSpeakStart?.();
  }, []);

  const markSpeakEnd = useCallback(() => {
    if (!speakingActiveRef.current) return;
    speakingActiveRef.current = false;
    callbacksRef.current?.onSpeakEnd?.();
  }, []);

  const stopAudio = useCallback(() => {
    if (!audioRef.current) return;
    try {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
    } catch {}
    audioRef.current = null;
  }, []);

  const stopSpeakingInternal = useCallback((options: StopSpeakingOptions = {}) => {
    const wasSpeaking = speakingActiveRef.current;
    stopAudio();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
    if (wasSpeaking) {
      if (!options.silent) callbacksRef.current?.onInterrupted?.();
      markSpeakEnd();
    }
  }, [markSpeakEnd, stopAudio]);

  const stopSpeaking = useCallback((options: StopSpeakingOptions = {}) => {
    playbackGenerationRef.current += 1;
    stopSpeakingInternal(options);
  }, [stopSpeakingInternal]);

  const primePlayback = useCallback(async () => {
    if (mediaPrimedRef.current) return true;
    if (mediaPrimePromiseRef.current) return mediaPrimePromiseRef.current;
    const primePromise = (async () => {
      try {
      const audio = new Audio(SILENT_AUDIO_DATA_URI);
      audio.muted = true;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      mediaPrimedRef.current = true;
      callbacksRef.current?.onDiagnostic?.('media_playback_primed');
      return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'prime failed';
        const lowered = message.toLowerCase();
        if (!lowered.includes('aborted') && !lowered.includes('aborterror')) {
          callbacksRef.current?.onDiagnostic?.(`media_playback_prime_failed: ${message}`, 'warn');
        }
        return false;
      } finally {
        mediaPrimePromiseRef.current = null;
      }
    })();
    mediaPrimePromiseRef.current = primePromise;
    return primePromise;
  }, []);

  const speakBrowser = useCallback((text: string, generation: number) => {
    return new Promise<void>((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('Browser speech synthesis unavailable'));
        return;
      }
      window.speechSynthesis.cancel();
      const startedAt = performance.now();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      const voices = window.speechSynthesis.getVoices();
      const frenchVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith('fr'));
      if (frenchVoice) utterance.voice = frenchVoice;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => {
        if (generation !== playbackGenerationRef.current) {
          window.speechSynthesis.cancel();
          reject(new Error('Playback superseded'));
          return;
        }
        markSpeakStart();
        setIsSpeaking(true);
        callbacksRef.current?.onDiagnostic?.(
          `audio_play_start | ms=${Math.round(performance.now() - startedAt)} | engine=browser`,
        );
      };
      utterance.onend = () => {
        if (generation !== playbackGenerationRef.current) {
          resolve();
          return;
        }
        markSpeakEnd();
        setIsSpeaking(false);
        callbacksRef.current?.onDiagnostic?.(
          `audio_play_end | ms=${Math.round(performance.now() - startedAt)} | engine=browser`,
        );
        resolve();
      };
      utterance.onerror = () => {
        markSpeakEnd();
        setIsSpeaking(false);
        reject(new Error('Browser speech synthesis failed'));
      };
      window.speechSynthesis.speak(utterance);
    });
  }, [markSpeakEnd, markSpeakStart]);

  const playLocalAudio = useCallback((src: string, generation: number, engine: VoiceEngine) => {
    return new Promise<void>((resolve, reject) => {
      const startedAt = performance.now();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      stopAudio();
      const audio = new Audio(src);
      audioRef.current = audio;
      const finalize = (fn: () => void) => {
        if (audioRef.current === audio) audioRef.current = null;
        fn();
      };
      audio.onplay = () => {
        if (generation !== playbackGenerationRef.current) {
          try {
            audio.pause();
            audio.src = '';
            audio.load();
          } catch {}
          finalize(() => reject(new Error('Playback superseded')));
          return;
        }
        markSpeakStart();
        setIsSpeaking(true);
        callbacksRef.current?.onDiagnostic?.(
          `audio_play_start | ms=${Math.round(performance.now() - startedAt)} | engine=${engine}`,
        );
      };
      audio.onended = () => {
        if (generation !== playbackGenerationRef.current) {
          finalize(resolve);
          return;
        }
        markSpeakEnd();
        setIsSpeaking(false);
        callbacksRef.current?.onDiagnostic?.(
          `audio_play_end | ms=${Math.round(performance.now() - startedAt)} | engine=${engine}`,
        );
        finalize(resolve);
      };
      audio.onerror = () => {
        try {
          audio.pause();
        } catch {}
        markSpeakEnd();
        setIsSpeaking(false);
        finalize(() => reject(new Error('Local audio playback failed')));
      };
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch((err) => {
          markSpeakEnd();
          setIsSpeaking(false);
          const message = err instanceof Error ? err.message : 'Local audio playback failed';
          finalize(() => reject(new Error(`Local audio playback failed: ${message}`)));
        });
      }
    });
  }, [markSpeakEnd, markSpeakStart, stopAudio]);

  const speak = useCallback(async (text: string, preferLocalVoice = true): Promise<SpeakResult | null> => {
    const cleaned = text.trim();
    if (!cleaned) return null;
    const generation = playbackGenerationRef.current + 1;
    playbackGenerationRef.current = generation;
    stopSpeakingInternal({ silent: true });

    if (preferLocalVoice) {
      try {
        callbacksRef.current?.onDiagnostic?.('tts_request_start');
        const ttsStartedAt = performance.now();
        const response = await speakWithLocalVoice(cleaned, 'kokoro', HERMES_KOKORO_SPEED);
        if (generation !== playbackGenerationRef.current) {
          return { engine: 'none', usedLocalVoice: false, localFailure: false, cancelled: true };
        }
        const engine = String(response.engine_used || '').toLowerCase();
        const engineUsed: VoiceEngine =
          engine === 'kokoro' || engine === 'piper' || engine === 'espeak' ? (engine as VoiceEngine) : 'browser';
        setLastEngine(engineUsed);
        callbacksRef.current?.onDiagnostic?.(
          `tts_request_done | ms=${Math.round(performance.now() - ttsStartedAt)} | engine=${engineUsed} | speed=${response.speed ?? HERMES_KOKORO_SPEED}`,
        );
        await playLocalAudio(response.audio_url_abs, generation, engineUsed);
        callbacksRef.current?.onDiagnostic?.('Browser fallback skipped because Kokoro succeeded.');
        return { engine: engineUsed, usedLocalVoice: true, localFailure: false };
      } catch (localError) {
        const localMessage = localError instanceof Error ? localError.message : 'Local audio playback failed';
        if (localMessage.toLowerCase().includes('superseded')) {
          return { engine: 'none', usedLocalVoice: false, localFailure: false, cancelled: true };
        }
        callbacksRef.current?.onDiagnostic?.(`Kokoro/local voice failed: ${localMessage}`, 'warn');
        setLastEngine('none');
        return { engine: 'none', usedLocalVoice: false, localFailure: true, error: localMessage };
      }
    }

    try {
      setLastEngine('browser');
      await speakBrowser(cleaned, generation);
      return { engine: 'browser', usedLocalVoice: false, localFailure: preferLocalVoice };
    } catch (browserError) {
      const browserMessage = browserError instanceof Error ? browserError.message : 'Browser speech synthesis failed';
      if (browserMessage.toLowerCase().includes('superseded')) {
        return { engine: 'none', usedLocalVoice: false, localFailure: false, cancelled: true };
      }
      markSpeakEnd();
      setIsSpeaking(false);
      return { engine: 'browser', usedLocalVoice: false, localFailure: true, error: browserMessage };
    }
  }, [markSpeakEnd, playLocalAudio, speakBrowser, stopSpeakingInternal]);

  useEffect(() => {
    return () => {
      stopSpeaking({ silent: true });
    };
  }, [stopSpeaking]);

  return { isSpeaking, speak, lastEngine, stopSpeaking, primePlayback };
}
