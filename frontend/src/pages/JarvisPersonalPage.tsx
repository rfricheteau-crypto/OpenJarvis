import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Mic, MicOff, RefreshCw, Send, Sparkles, Volume2, Waves } from 'lucide-react';
import { toast } from 'sonner';

import {
  fetchPersonalCockpit,
  fetchVoiceHealth,
  sendPersonalCockpitChat,
  speakWithLocalVoice,
  type VoiceHealthResponse,
} from '../lib/api';
import { useSpeech } from '../hooks/useSpeech';
import type { PersonalCockpitChatMessage, PersonalCockpitSnapshot } from '../types';
import { JarvisCockpitFullView } from './JarvisCockpitFullView';

const HOME_GREETING = "Bonjour Ruth, qu’est-ce qu’on fait aujourd’hui ?";
const GREETING_MEMORY_KEY = 'jarvis-home-greeted-day';
const LOCAL_VOICE_PREF_KEY = 'jarvis-local-voice-enabled';
const CONTINUOUS_VOICE_PREF_KEY = 'jarvis-continuous-voice-enabled';
const VAD_PROFILE_PREF_KEY = 'jarvis-vad-profile';
const VAD_THRESHOLD_OFFSET_PREF_KEY = 'jarvis-vad-threshold-offset';
const VAD_SILENCE_OFFSET_PREF_KEY = 'jarvis-vad-silence-offset';
const ECHO_GUARD_OFFSET_PREF_KEY = 'jarvis-echo-guard-offset';
const VOICE_HEALTH_REFRESH_MS = 25000;
const DUPLICATE_VOICE_WINDOW_MS = 6500;
const VOICE_DIAGNOSTICS_LIMIT = 12;
const HERMES_HISTORY_MAX_MESSAGES = 6;
const HERMES_HISTORY_MAX_CHARS = 1400;
const HERMES_HISTORY_MAX_ENTRY_CHARS = 320;
const HERMES_SPOKEN_MAX_SENTENCES = 1;
const HERMES_SPOKEN_MAX_CHARS = 120;
const HERMES_KOKORO_SPEED = 1.12;
const CONTINUOUS_VAD_THRESHOLD_BIAS = 0.0035;
const CONTINUOUS_NO_SPEECH_TIMEOUT_BOOST_MS = 4200;
const CONTINUOUS_SILENCE_REDUCTION_MS = 80;
const HERMES_V2_VOICE_URL = 'http://127.0.0.1:8790/web/';

type Mode = 'hermes' | 'cockpit';
type VoiceUiState = 'idle' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
type ConversationRole = 'user' | 'assistant';
type VoiceEngine = 'none' | 'kokoro' | 'piper' | 'espeak' | 'browser';
type VoiceStatusLabel = 'ready' | 'degraded' | 'unavailable' | 'off';
type VadProfileId = 'mac_speakers' | 'headphones' | 'quiet_room' | 'noisy_room';

type VadProfile = {
  label: string;
  vadThreshold: number;
  silenceDurationMs: number;
  minSpeechMs: number;
  noSpeechTimeoutMs: number;
  maxRecordingMs: number;
  ignoreAudioUntilMs: number;
  postSpeakGuardMs: number;
  bargeInThresholdBoost: number;
};

const VAD_PROFILES: Record<VadProfileId, VadProfile> = {
  mac_speakers: {
    label: 'Mac speakers',
    vadThreshold: 0.02,
    silenceDurationMs: 560,
    minSpeechMs: 180,
    noSpeechTimeoutMs: 2600,
    maxRecordingMs: 13000,
    ignoreAudioUntilMs: 160,
    postSpeakGuardMs: 760,
    bargeInThresholdBoost: 0.012,
  },
  headphones: {
    label: 'Headphones',
    vadThreshold: 0.016,
    silenceDurationMs: 620,
    minSpeechMs: 180,
    noSpeechTimeoutMs: 1800,
    maxRecordingMs: 13000,
    ignoreAudioUntilMs: 120,
    postSpeakGuardMs: 320,
    bargeInThresholdBoost: 0.006,
  },
  quiet_room: {
    label: 'Quiet room',
    vadThreshold: 0.014,
    silenceDurationMs: 560,
    minSpeechMs: 170,
    noSpeechTimeoutMs: 2000,
    maxRecordingMs: 12000,
    ignoreAudioUntilMs: 120,
    postSpeakGuardMs: 700,
    bargeInThresholdBoost: 0.008,
  },
  noisy_room: {
    label: 'Noisy room',
    vadThreshold: 0.028,
    silenceDurationMs: 820,
    minSpeechMs: 220,
    noSpeechTimeoutMs: 3200,
    maxRecordingMs: 14000,
    ignoreAudioUntilMs: 220,
    postSpeakGuardMs: 950,
    bargeInThresholdBoost: 0.014,
  },
};

type SpeakResult = {
  engine: VoiceEngine;
  usedLocalVoice: boolean;
  localFailure: boolean;
  error?: string;
  cancelled?: boolean;
};

type ConversationEntry = {
  id: string;
  role: ConversationRole;
  content: string;
  channel: 'voice' | 'text';
  createdAt: number;
};

type HomeActionCard = {
  id: string;
  title: string;
  detail: string;
  source: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: string;
};

type VoiceDiagnosticLevel = 'info' | 'warn' | 'error';

type VoiceDiagnosticEntry = {
  id: string;
  at: number;
  level: VoiceDiagnosticLevel;
  text: string;
};

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function normalizeCommand(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVoiceText(input: string): string {
  return normalizeCommand(input)
    .replace(/\b(euh|hum|hmm)\b/g, '')
    .trim();
}

function buildSpokenReply(input: string): string {
  const cleaned = safeString(input)
    .replace(/[`*_#>-]/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const segments = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length === 0) return cleaned;

  const chosen: string[] = [];
  let total = 0;
  for (const segment of segments) {
    const next = total === 0 ? segment.length : total + 1 + segment.length;
    if (chosen.length >= HERMES_SPOKEN_MAX_SENTENCES || next > HERMES_SPOKEN_MAX_CHARS) break;
    chosen.push(segment);
    total = next;
  }

  const spoken = chosen.join(' ').trim();
  if (spoken) return spoken;

  const clipped = cleaned.slice(0, HERMES_SPOKEN_MAX_CHARS).trim();
  if (cleaned.length <= HERMES_SPOKEN_MAX_CHARS) return clipped;
  const lastSpace = clipped.lastIndexOf(' ');
  const compact = lastSpace > 72 ? clipped.slice(0, lastSpace).trim() : clipped;
  return compact.endsWith('.') || compact.endsWith('!') || compact.endsWith('?') ? compact : `${compact}.`;
}

function clipText(value: string, maxChars: number): string {
  const cleaned = safeString(value).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  const clipped = cleaned.slice(0, maxChars).trim();
  const lastSpace = clipped.lastIndexOf(' ');
  return (lastSpace > Math.floor(maxChars * 0.6) ? clipped.slice(0, lastSpace) : clipped).trim();
}

function buildHermesHistory(entries: ConversationEntry[]): PersonalCockpitChatMessage[] {
  const normalized = entries
    .filter((entry) => entry.id !== 'seed-greeting')
    .map((entry) => ({
      role: entry.role,
      content: clipText(entry.content, HERMES_HISTORY_MAX_ENTRY_CHARS),
    }))
    .filter((entry) => entry.content.length > 0);

  const recent = normalized.slice(-HERMES_HISTORY_MAX_MESSAGES);
  const kept: PersonalCockpitChatMessage[] = [];
  let totalChars = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const candidate = recent[index];
    const nextChars = totalChars + candidate.content.length;
    if (kept.length > 0 && nextChars > HERMES_HISTORY_MAX_CHARS) break;
    kept.unshift(candidate);
    totalChars = nextChars;
  }
  return kept;
}

function isOpenCockpitCommand(input: string): boolean {
  const value = normalizeCommand(input);
  return (
    value.includes('ouvre le cockpit') ||
    value.includes('ouvre mon cockpit') ||
    value.includes('montre moi le cockpit') ||
    value.includes('ouvre ruth os')
  );
}

function isReturnHermesCommand(input: string): boolean {
  const value = normalizeCommand(input);
  return (
    value.includes('retour hermes') ||
    value.includes('retour a hermes') ||
    value.includes('retour jarvis') ||
    value.includes('reviens a hermes') ||
    value.includes('revenir a hermes')
  );
}

function priorityTone(priority: HomeActionCard['priority']) {
  if (priority === 'urgent') return { label: 'urgent', color: '#ff7b7b', border: 'rgba(255,123,123,0.5)' };
  if (priority === 'high') return { label: 'high', color: '#f6c76e', border: 'rgba(246,199,110,0.5)' };
  if (priority === 'low') return { label: 'low', color: '#82d6ff', border: 'rgba(130,214,255,0.45)' };
  return { label: 'medium', color: '#9ec0ff', border: 'rgba(158,192,255,0.4)' };
}

function waitMs(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

type SpeakerCallbacks = {
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
  onInterrupted?: () => void;
  onDiagnostic?: (message: string, level?: VoiceDiagnosticLevel) => void;
};

type StopSpeakingOptions = {
  silent?: boolean;
};

function pickTodayPriorities(data: PersonalCockpitSnapshot): string[] {
  const picked: string[] = [];

  const primary = safeString(data.priorities?.primary).trim();
  if (primary) picked.push(primary);

  const secondary = Array.isArray(data.priorities?.secondary) ? data.priorities?.secondary : [];
  secondary.forEach((item) => {
    const text = safeString(item).trim();
    if (text && !picked.includes(text)) picked.push(text);
  });

  if (picked.length === 0) {
    const fallbackFromInbox = (data.obsidian_action_inbox || [])
      .filter((item) => item.status !== 'done')
      .sort((a, b) => {
        const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
      })
      .slice(0, 3)
      .map((item) => item.title);
    picked.push(...fallbackFromInbox);
  }

  return picked.slice(0, 4);
}

function buildActionCards(data: PersonalCockpitSnapshot): HomeActionCard[] {
  const cards: HomeActionCard[] = [];

  (data.pending_validations || [])
    .filter((item) => item.status !== 'done')
    .slice(0, 4)
    .forEach((item) => {
      cards.push({
        id: `pv-${item.id}`,
        title: item.title,
        detail: item.expected_action || item.why_pending,
        source: `Validation · ${item.project}`,
        priority: (item.priority as HomeActionCard['priority']) || 'medium',
        status: item.status,
      });
    });

  (data.obsidian_action_inbox || [])
    .filter((item) => item.status !== 'done')
    .slice(0, 5)
    .forEach((item) => {
      cards.push({
        id: `obs-${item.id}`,
        title: item.title,
        detail: item.action_requested,
        source: `Obsidian · ${item.project}`,
        priority: item.priority,
        status: item.status,
      });
    });

  (data.alerts || []).slice(0, 3).forEach((item, index) => {
    cards.push({
      id: `alert-${index}`,
      title: item.title,
      detail: item.detail,
      source: 'Alerte cockpit',
      priority: item.level === 'error' ? 'urgent' : item.level === 'warning' ? 'high' : 'medium',
      status: item.level,
    });
  });

  const seen = new Set<string>();
  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return cards
    .filter((card) => {
      const key = `${card.title}::${card.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9))
    .slice(0, 8);
}

function useHermesSpeaker(callbacks?: SpeakerCallbacks) {
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

export function JarvisPersonalPage() {
  const [mode, setMode] = useState<Mode>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'cockpit' ? 'cockpit' : 'hermes';
  });
  const [snapshot, setSnapshot] = useState<PersonalCockpitSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [cockpitCommandDraft, setCockpitCommandDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [localVoiceEnabled, setLocalVoiceEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(LOCAL_VOICE_PREF_KEY);
    return saved !== 'off';
  });
  const [continuousVoiceEnabled, setContinuousVoiceEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(CONTINUOUS_VOICE_PREF_KEY);
    return saved === 'on';
  });
  const [vadProfileId, setVadProfileId] = useState<VadProfileId>(() => {
    const saved = localStorage.getItem(VAD_PROFILE_PREF_KEY);
    if (saved === 'mac_speakers' || saved === 'headphones' || saved === 'quiet_room' || saved === 'noisy_room') {
      return saved;
    }
    return 'mac_speakers';
  });
  const [vadThresholdOffset, setVadThresholdOffset] = useState<number>(() => {
    const raw = localStorage.getItem(VAD_THRESHOLD_OFFSET_PREF_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [silenceOffsetMs, setSilenceOffsetMs] = useState<number>(() => {
    const raw = localStorage.getItem(VAD_SILENCE_OFFSET_PREF_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [echoGuardOffsetMs, setEchoGuardOffsetMs] = useState<number>(() => {
    const raw = localStorage.getItem(ECHO_GUARD_OFFSET_PREF_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [showVoiceTuning, setShowVoiceTuning] = useState(false);
  const [autoCalibrating, setAutoCalibrating] = useState(false);
  const [calibrationSummary, setCalibrationSummary] = useState<string | null>(null);
  const [continuousListeningActive, setContinuousListeningActive] = useState(false);
  const [conversationNotice, setConversationNotice] = useState<string | null>(null);
  const [voiceHealth, setVoiceHealth] = useState<VoiceHealthResponse | null>(null);
  const [voiceHealthStatus, setVoiceHealthStatus] = useState<VoiceStatusLabel>('unavailable');
  const [voiceStatusText, setVoiceStatusText] = useState('Voix locale: vérification…');
  const [voiceFallbackNotice, setVoiceFallbackNotice] = useState<string | null>(null);
  const [hasUserGesture, setHasUserGesture] = useState(false);
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<VoiceDiagnosticEntry[]>([]);
  const [conversation, setConversation] = useState<ConversationEntry[]>([
    {
      id: 'seed-greeting',
      role: 'assistant',
      content: HOME_GREETING,
      channel: 'voice',
      createdAt: Date.now(),
    },
  ]);

  const pushDiagnostic = useCallback((text: string, level: VoiceDiagnosticLevel = 'info') => {
    const entry: VoiceDiagnosticEntry = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      level,
      text,
    };
    setVoiceDiagnostics((prev) => [...prev, entry].slice(-VOICE_DIAGNOSTICS_LIMIT));
  }, []);

  const speech = useSpeech({
    onDiagnostic: ({ message, level }) => {
      const entry: VoiceDiagnosticEntry = {
        id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        level: (level || 'info') as VoiceDiagnosticLevel,
        text: message,
      };
      setVoiceDiagnostics((prev) => [...prev, entry].slice(-VOICE_DIAGNOSTICS_LIMIT));
    },
  });
  const activeVadRef = useRef<VadProfile>(VAD_PROFILES.mac_speakers);
  const echoGuardUntilRef = useRef(0);
  const lastVoiceSentRef = useRef<{ normalized: string; at: number }>({ normalized: '', at: 0 });
  const lastAssistantVoiceRef = useRef<{ normalized: string; at: number }>({ normalized: '', at: 0 });
  const conversationNoticeTimeoutRef = useRef<number | null>(null);
  const {
    isSpeaking,
    speak,
    lastEngine,
    stopSpeaking,
    primePlayback,
  } = useHermesSpeaker({
    onSpeakStart: () => {
      const now = Date.now();
      echoGuardUntilRef.current = now + Math.max(activeVadRef.current.ignoreAudioUntilMs, 420);
      speech.cancelRecording();
      pushDiagnostic('Hermès parle: capture micro temporairement stoppée.');
    },
    onSpeakEnd: () => {
      const now = Date.now();
      echoGuardUntilRef.current = now + activeVadRef.current.postSpeakGuardMs;
      pushDiagnostic('anti_echo_wait_start');
      pushDiagnostic(`Lecture terminée · garde anti-écho ${activeVadRef.current.postSpeakGuardMs} ms.`);
      if (continuousEnabledRef.current && modeRef.current === 'hermes') {
        setConversationNotice(`Reprise écoute dans ${activeVadRef.current.postSpeakGuardMs} ms`);
      }
    },
    onInterrupted: () => {
      pushDiagnostic('Lecture interrompue par une nouvelle prise de parole.', 'warn');
    },
    onDiagnostic: (message, level = 'info') => {
      pushDiagnostic(message, level);
    },
  });
  const sessionId = useRef(`jarvis-hermes-${crypto.randomUUID()}`);
  const isSpeakingRef = useRef(false);
  const sendingRef = useRef(false);
  const speechAvailableRef = useRef(speech.available);
  const speechIsTranscribingRef = useRef(speech.isTranscribing);
  const modeRef = useRef<Mode>(mode);
  const continuousEnabledRef = useRef(continuousVoiceEnabled);
  const continuousNoSpeechCountRef = useRef(0);
  const continuousToggleGuardRef = useRef(false);
  const continuousLoopRunningRef = useRef(false);
  const previousVoiceStatusRef = useRef<string>('');
  const sendToHermesRef = useRef<(message: string, channel: 'voice' | 'text') => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPersonalCockpit();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Jarvis Home indisponible');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openVoiceV2 = useCallback(() => {
    speech.cancelRecording();
    stopSpeaking({ silent: true });
    window.open(HERMES_V2_VOICE_URL, '_blank', 'noopener,noreferrer');
  }, [speech.cancelRecording, stopSpeaking]);

  const refreshVoiceHealth = useCallback(async () => {
    if (!localVoiceEnabled) {
      setVoiceHealth(null);
      setVoiceHealthStatus('off');
      setVoiceStatusText('Voix locale OFF · navigateur');
      return;
    }
    try {
      const next = await fetchVoiceHealth();
      setVoiceHealth(next);
      if (next.status === 'ready') {
        setVoiceHealthStatus('ready');
        setVoiceStatusText('Voix locale prête · Kokoro');
      } else if (next.status === 'degraded') {
        if (!next.sidecar_available) {
          setVoiceHealthStatus('degraded');
          setVoiceStatusText('Sidecar non démarré');
        } else {
          setVoiceHealthStatus('degraded');
          setVoiceStatusText('Kokoro indisponible · Piper actif');
        }
      } else {
        if (!next.sidecar_available) {
          setVoiceHealthStatus('degraded');
          setVoiceStatusText('Sidecar non démarré');
        } else {
          setVoiceHealthStatus('unavailable');
          setVoiceStatusText('Voix locale indisponible · navigateur');
        }
      }
    } catch {
      setVoiceHealth(null);
      setVoiceHealthStatus('unavailable');
      setVoiceStatusText('Voix locale indisponible · navigateur');
    }
  }, [localVoiceEnabled]);

  useEffect(() => {
    void refreshVoiceHealth();
    const timer = window.setInterval(() => {
      void refreshVoiceHealth();
    }, VOICE_HEALTH_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshVoiceHealth]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('mode', mode);
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', next);
  }, [mode]);

  useEffect(() => {
    const unlock = () => {
      setHasUserGesture(true);
      void primePlayback();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [primePlayback]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const alreadyGreeted = localStorage.getItem(GREETING_MEMORY_KEY);
    if (alreadyGreeted === today) return;
    if (!hasUserGesture) return;
    void speak(HOME_GREETING, localVoiceEnabled);
    localStorage.setItem(GREETING_MEMORY_KEY, today);
  }, [hasUserGesture, localVoiceEnabled, speak]);

  useEffect(() => {
    localStorage.setItem(LOCAL_VOICE_PREF_KEY, localVoiceEnabled ? 'on' : 'off');
    if (!localVoiceEnabled) {
      setVoiceFallbackNotice(null);
      setVoiceHealthStatus('off');
      setVoiceStatusText('Voix locale OFF · navigateur');
    } else {
      void refreshVoiceHealth();
    }
  }, [localVoiceEnabled, refreshVoiceHealth]);

  useEffect(() => {
    localStorage.setItem(CONTINUOUS_VOICE_PREF_KEY, continuousVoiceEnabled ? 'on' : 'off');
  }, [continuousVoiceEnabled]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    speechAvailableRef.current = speech.available;
  }, [speech.available]);

  useEffect(() => {
    speechIsTranscribingRef.current = speech.isTranscribing;
  }, [speech.isTranscribing]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    continuousEnabledRef.current = continuousVoiceEnabled;
  }, [continuousVoiceEnabled]);

  useEffect(() => {
    localStorage.setItem(VAD_PROFILE_PREF_KEY, vadProfileId);
  }, [vadProfileId]);

  useEffect(() => {
    localStorage.setItem(VAD_THRESHOLD_OFFSET_PREF_KEY, String(vadThresholdOffset));
  }, [vadThresholdOffset]);

  useEffect(() => {
    localStorage.setItem(VAD_SILENCE_OFFSET_PREF_KEY, String(silenceOffsetMs));
  }, [silenceOffsetMs]);

  useEffect(() => {
    localStorage.setItem(ECHO_GUARD_OFFSET_PREF_KEY, String(echoGuardOffsetMs));
  }, [echoGuardOffsetMs]);

  useEffect(() => {
    if (!voiceStatusText) return;
    if (previousVoiceStatusRef.current === voiceStatusText) return;
    previousVoiceStatusRef.current = voiceStatusText;
    const level: VoiceDiagnosticLevel = voiceHealthStatus === 'unavailable' ? 'warn' : 'info';
    pushDiagnostic(`État voix: ${voiceStatusText}`, level);
  }, [pushDiagnostic, voiceHealthStatus, voiceStatusText]);

  useEffect(() => {
    return () => {
      if (conversationNoticeTimeoutRef.current != null) {
        window.clearTimeout(conversationNoticeTimeoutRef.current);
      }
    };
  }, []);

  const activeVad = useMemo(() => {
    const base = VAD_PROFILES[vadProfileId];
    return {
      ...base,
      vadThreshold: Math.max(0.008, Math.min(0.08, base.vadThreshold + vadThresholdOffset)),
      silenceDurationMs: Math.max(420, Math.min(1800, base.silenceDurationMs + silenceOffsetMs)),
      postSpeakGuardMs: Math.max(120, Math.min(2200, base.postSpeakGuardMs + echoGuardOffsetMs)),
    };
  }, [echoGuardOffsetMs, silenceOffsetMs, vadProfileId, vadThresholdOffset]);

  useEffect(() => {
    activeVadRef.current = activeVad;
  }, [activeVad]);

  const pushConversationNotice = useCallback((message: string, durationMs = 1800) => {
    setConversationNotice(message);
    if (conversationNoticeTimeoutRef.current != null) {
      window.clearTimeout(conversationNoticeTimeoutRef.current);
    }
    conversationNoticeTimeoutRef.current = window.setTimeout(() => {
      setConversationNotice(null);
      conversationNoticeTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const runAutoCalibration = useCallback(async () => {
    if (autoCalibrating || speech.isRecording || speech.isTranscribing) return;
    setAutoCalibrating(true);
    setCalibrationSummary(null);
    try {
      pushConversationNotice('Calibration en cours: reste 2 secondes en silence…', 2200);
      pushDiagnostic('Calibration VAD démarrée.');
      const metrics = await speech.measureAmbientLevel(2000);
      const baseThreshold = VAD_PROFILES[vadProfileId].vadThreshold;
      const nextOffset = Number((metrics.recommendedThreshold - baseThreshold).toFixed(3));
      setVadThresholdOffset(nextOffset);
      setCalibrationSummary(
        `Bruit moyen ${metrics.averageLevel.toFixed(3)} · seuil conseillé ${metrics.recommendedThreshold.toFixed(3)}`,
      );
      pushDiagnostic(`Calibration appliquée: seuil ${metrics.recommendedThreshold.toFixed(3)}.`);
      toast.success('Calibration voix appliquée');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Calibration impossible';
      setCalibrationSummary(`Échec calibration: ${message}`);
      pushDiagnostic(`Calibration échouée: ${message}`, 'error');
      toast.error(message);
    } finally {
      setAutoCalibrating(false);
    }
  }, [
    autoCalibrating,
    pushConversationNotice,
    pushDiagnostic,
    speech.isRecording,
    speech.isTranscribing,
    speech.measureAmbientLevel,
    vadProfileId,
  ]);

  const chatHistoryForApi: PersonalCockpitChatMessage[] = useMemo(
    () => buildHermesHistory(conversation),
    [conversation],
  );
  const chatHistoryStats = useMemo(() => ({
    messages: chatHistoryForApi.length,
    chars: chatHistoryForApi.reduce((sum, item) => sum + item.content.length, 0),
  }), [chatHistoryForApi]);

  const waitingForSilence = useMemo(
    () => continuousVoiceEnabled && speech.isRecording && speech.speechDetected,
    [continuousVoiceEnabled, speech.isRecording, speech.speechDetected],
  );

  const uiVoiceState: VoiceUiState = useMemo(() => {
    if (speech.isTranscribing) return 'transcribing';
    if (sending) return 'thinking';
    if (isSpeaking) return 'speaking';
    if (speech.isRecording) return 'recording';
    if (continuousVoiceEnabled && mode === 'hermes') return 'listening';
    return 'idle';
  }, [continuousVoiceEnabled, isSpeaking, mode, sending, speech.isRecording, speech.isTranscribing]);

  const stateLabel = useMemo(() => {
    if (uiVoiceState === 'listening') {
      return continuousListeningActive ? 'Écoute en cours' : 'Écoute continue armée';
    }
    if (uiVoiceState === 'recording') return waitingForSilence ? 'En attente de silence' : 'Ruth parle';
    if (uiVoiceState === 'transcribing') return 'Transcription en cours';
    if (uiVoiceState === 'thinking') return 'Hermès réfléchit';
    if (uiVoiceState === 'speaking') return 'Hermès parle';
    return 'En attente';
  }, [continuousListeningActive, uiVoiceState, waitingForSilence]);
  const engineLabel = useMemo(() => {
    const prefix = isSpeaking ? 'Voix en lecture' : 'Dernière voix';
    if (lastEngine === 'kokoro') return `${prefix}: Kokoro`;
    if (lastEngine === 'piper') return `${prefix}: Piper`;
    if (lastEngine === 'espeak') return `${prefix}: eSpeak`;
    if (lastEngine === 'browser') return `${prefix}: Browser fallback`;
    return 'Voix: en attente';
  }, [isSpeaking, lastEngine]);
  const voiceStatusTone = useMemo(() => {
    if (voiceHealthStatus === 'ready') {
      return { color: '#c7ffd4', border: 'rgba(108, 230, 154, 0.4)', bg: 'rgba(27, 66, 44, 0.42)' };
    }
    if (voiceHealthStatus === 'degraded') {
      return { color: '#ffe3b2', border: 'rgba(246, 199, 110, 0.42)', bg: 'rgba(76, 57, 23, 0.36)' };
    }
    if (voiceHealthStatus === 'off') {
      return { color: '#d6e3fb', border: 'rgba(150, 189, 255, 0.28)', bg: 'rgba(16, 27, 46, 0.45)' };
    }
    return { color: '#ffd1d1', border: 'rgba(255, 123, 123, 0.42)', bg: 'rgba(78, 26, 26, 0.38)' };
  }, [voiceHealthStatus]);

  const todayPriorities = useMemo(() => (snapshot ? pickTodayPriorities(snapshot) : []), [snapshot]);
  const actionCards = useMemo(() => (snapshot ? buildActionCards(snapshot) : []), [snapshot]);

  const openCockpit = useCallback((spoken = false) => {
    setMode('cockpit');
    if (spoken) void speak("J’ouvre le cockpit Ruth OS.", localVoiceEnabled);
  }, [localVoiceEnabled, speak]);

  const returnHermes = useCallback((spoken = false) => {
    setMode('hermes');
    if (spoken) void speak('Retour à la conversation Hermès.', localVoiceEnabled);
  }, [localVoiceEnabled, speak]);

  const appendConversation = useCallback((entry: Omit<ConversationEntry, 'id' | 'createdAt'>) => {
    setConversation((prev) => [
      ...prev,
      {
        id: `${entry.role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        ...entry,
      },
    ]);
  }, []);

  const handleCommandOnly = useCallback((text: string): boolean => {
    if (isOpenCockpitCommand(text)) {
      openCockpit(true);
      return true;
    }
    if (isReturnHermesCommand(text)) {
      returnHermes(true);
      return true;
    }
    return false;
  }, [openCockpit, returnHermes]);

  const sendToHermes = useCallback(async (message: string, channel: 'voice' | 'text') => {
    const text = message.trim();
    if (!text) return;
    const normalized = normalizeVoiceText(text);
    if (channel === 'voice' && normalized) {
      const duplicateAge = Date.now() - lastVoiceSentRef.current.at;
      if (lastVoiceSentRef.current.normalized === normalized && duplicateAge < DUPLICATE_VOICE_WINDOW_MS) {
        pushDiagnostic('Phrase vocale dupliquée ignorée pour éviter un double tour.', 'warn');
        return;
      }
      lastVoiceSentRef.current = { normalized, at: Date.now() };
    }

    speech.cancelRecording();
    stopSpeaking({ silent: true });
    setVoiceFallbackNotice(null);
    setConversationNotice(null);
    pushDiagnostic(channel === 'voice' ? 'Tour vocal envoyé à Hermès.' : 'Message texte envoyé à Hermès.');

    if (handleCommandOnly(text)) {
      pushDiagnostic('Commande de navigation locale traitée (sans appel Hermès).');
      appendConversation({ role: 'user', content: text, channel });
      appendConversation({
        role: 'assistant',
        content: isOpenCockpitCommand(text)
          ? "D’accord Ruth, j’ouvre le cockpit."
          : 'D’accord Ruth, retour à la conversation Hermès.',
        channel: 'voice',
      });
      return;
    }

    setSending(true);
    appendConversation({ role: 'user', content: text, channel });
    try {
      const hermesRequestStartedAt = performance.now();
      pushDiagnostic(`Hermès contexte | messages=${chatHistoryStats.messages} | chars=${chatHistoryStats.chars}`);
      pushDiagnostic('hermes_request_start');
      const response = await sendPersonalCockpitChat(text, chatHistoryForApi, 'auto', sessionId.current);
      pushDiagnostic(`hermes_response_done | ms=${Math.round(performance.now() - hermesRequestStartedAt)}`);
      const reply = safeString(response.reply, 'Je suis prête pour la suite.');
      const spokenReply = buildSpokenReply(reply);
      const normalizedReply = normalizeVoiceText(reply);
      if (normalizedReply) {
        lastAssistantVoiceRef.current = { normalized: normalizedReply, at: Date.now() };
      }
      appendConversation({ role: 'assistant', content: reply, channel: 'voice' });
      setSending(false);
      pushDiagnostic('Réponse Hermès reçue.');
      requestAnimationFrame(() => {
        pushDiagnostic('ui_render_done');
      });
      if (spokenReply && spokenReply !== reply) {
        pushDiagnostic(`Réponse voix abrégée | visible=${reply.length} | voix=${spokenReply.length}`);
      }
      const ttsJourneyStartedAt = performance.now();
      const speakResult = await speak(spokenReply || reply, localVoiceEnabled);
      if (speakResult?.cancelled) {
        pushDiagnostic('Lecture audio annulée par une requête plus récente.', 'warn');
      } else if (speakResult?.usedLocalVoice && (speakResult.engine === 'kokoro' || speakResult.engine === 'piper' || speakResult.engine === 'espeak')) {
        pushDiagnostic(`Audio reçu depuis /api/voice/speak (${speakResult.engine}).`);
        pushDiagnostic(`tts_journey_done | ms=${Math.round(performance.now() - ttsJourneyStartedAt)} | engine=${speakResult.engine}`);
      }
      if (speakResult?.engine === 'piper' || speakResult?.engine === 'espeak') {
        setVoiceFallbackNotice('Kokoro indisponible, moteur de secours utilisé.');
        pushDiagnostic(`Fallback moteur local: ${speakResult.engine}.`, 'warn');
      } else if (speakResult?.engine === 'browser' && localVoiceEnabled) {
        setVoiceFallbackNotice('Voix locale indisponible, fallback navigateur utilisé.');
        pushDiagnostic('Fallback navigateur utilisé (voix locale indisponible).', 'warn');
      } else if (speakResult?.engine === 'kokoro') {
        pushDiagnostic('Lecture locale Kokoro OK.');
      }
      if (speakResult?.error) {
        const lowered = speakResult.error.toLowerCase();
        const isBlocked = lowered.includes('notallowed') || lowered.includes('interact') || lowered.includes('gesture');
        if (isBlocked) {
          setVoiceFallbackNotice('Lecture audio bloquée par le navigateur. Clique sur “Rejouer le bonjour” puis réessaie.');
          pushDiagnostic(`Lecture bloquée navigateur: ${speakResult.error}`, 'error');
        } else {
          setVoiceFallbackNotice(`Erreur lecture audio: ${speakResult.error}`);
          pushDiagnostic(`Erreur lecture audio: ${speakResult.error}`, 'error');
        }
      }
      void refreshVoiceHealth();
    } catch (err) {
      const fallback = "Je n’ai pas pu joindre Hermès pour cette demande.";
      appendConversation({ role: 'assistant', content: fallback, channel: 'voice' });
      pushDiagnostic('Erreur appel Hermès.', 'error');
      toast.error(err instanceof Error ? err.message : 'Réponse Hermès indisponible');
    } finally {
      setSending(false);
    }
  }, [appendConversation, chatHistoryForApi, chatHistoryStats.chars, chatHistoryStats.messages, handleCommandOnly, localVoiceEnabled, pushDiagnostic, refreshVoiceHealth, speak, speech.cancelRecording, stopSpeaking]);

  useEffect(() => {
    sendToHermesRef.current = sendToHermes;
  }, [sendToHermes]);

  useEffect(() => {
    let cancelled = false;

    const runContinuousLoop = async () => {
      if (!continuousVoiceEnabled || mode !== 'hermes') return;
      if (continuousLoopRunningRef.current) return;

      continuousLoopRunningRef.current = true;
      setContinuousListeningActive(true);
      continuousNoSpeechCountRef.current = 0;
      pushDiagnostic('continuous_enabled');
      pushConversationNotice('Écoute continue active', 1200);
      try {
        while (!cancelled && continuousEnabledRef.current && modeRef.current === 'hermes') {
        const now = Date.now();
        if (!speechAvailableRef.current) {
          const recovered = await speech.refreshAvailability();
          if (!recovered) {
            const reason = speech.availabilityDetail?.reason || 'service STT non joignable';
            setConversationNotice(`Transcription indisponible: ${reason}.`);
            await waitMs(500);
            continue;
          }
          pushDiagnostic('Backend transcription de nouveau disponible.');
        }

        if (sendingRef.current || speechIsTranscribingRef.current) {
          await waitMs(70);
          continue;
        }
        // Stability-first: do not capture while Hermès is speaking (prevents self-trigger interruptions).
        if (isSpeakingRef.current) {
          await waitMs(70);
          continue;
        }
        if (!isSpeakingRef.current && now < echoGuardUntilRef.current) {
          await waitMs(60);
          continue;
        }

        try {
          pushDiagnostic('continuous_start_listening_requested');
          const tunedVadThreshold = Math.max(0.01, activeVad.vadThreshold - CONTINUOUS_VAD_THRESHOLD_BIAS);
          const tunedNoSpeechTimeoutMs = Math.min(
            activeVad.maxRecordingMs,
            activeVad.noSpeechTimeoutMs + CONTINUOUS_NO_SPEECH_TIMEOUT_BOOST_MS,
          );
          const tunedSilenceDurationMs = Math.max(460, activeVad.silenceDurationMs - CONTINUOUS_SILENCE_REDUCTION_MS);
          const transcript = await speech.recordUntilSilence({
            silenceDurationMs: tunedSilenceDurationMs,
            minSpeechMs: activeVad.minSpeechMs,
            noSpeechTimeoutMs: tunedNoSpeechTimeoutMs,
            maxRecordingMs: activeVad.maxRecordingMs,
            vadThreshold: tunedVadThreshold,
            ignoreAudioUntilMs: activeVad.ignoreAudioUntilMs,
            suppressNoSpeechDiagnostic: true,
            armOnSpeech: true,
          });

          if (cancelled) break;
          const text = transcript.trim();
          if (!text || text.length < 2) {
            continuousNoSpeechCountRef.current += 1;
            setVoiceFallbackNotice(null);
            if (continuousNoSpeechCountRef.current === 1 || continuousNoSpeechCountRef.current % 3 === 0) {
              pushDiagnostic('transcription_empty_retry_listening', 'warn');
            }
            setConversationNotice(
              continuousNoSpeechCountRef.current >= 2
                ? 'Je reste en écoute continue, parle dès que tu veux.'
                : 'Aucune parole comprise · reprise écoute…',
            );
            await waitMs(Math.min(420, 160 + continuousNoSpeechCountRef.current * 60));
            continue;
          }
          continuousNoSpeechCountRef.current = 0;
          const normalized = normalizeVoiceText(text);
          const echoAge = Date.now() - lastAssistantVoiceRef.current.at;
          if (normalized && normalized === lastAssistantVoiceRef.current.normalized && echoAge < 9000) {
            pushDiagnostic('Transcription ignorée: probable écho de la dernière réponse Hermès.', 'warn');
            await waitMs(80);
            continue;
          }

          setLastTranscript(text);
          pushDiagnostic(`Transcription captée: "${text.slice(0, 52)}${text.length > 52 ? '…' : ''}"`);
          await sendToHermesRef.current(text, 'voice');
          pushDiagnostic('continuous_restart_listening');
          await waitMs(80);
        } catch (err) {
          if (cancelled) break;
          const message = err instanceof Error ? err.message : 'Erreur micro continue';
          const lowered = message.toLowerCase();
          if (lowered.includes('denied') || lowered.includes('not supported')) {
            continuousEnabledRef.current = false;
            setContinuousVoiceEnabled(false);
            setContinuousListeningActive(false);
            pushDiagnostic('Conversation continue stoppée: accès micro indisponible.', 'error');
            toast.error('Conversation continue stoppée: accès micro indisponible.');
            break;
          }
          if (
            !lowered.includes('already recording')
            && !lowered.includes('not recording')
            && !lowered.includes('already in progress')
          ) {
            pushDiagnostic(`Erreur boucle continue: ${message}`, 'error');
            toast.error(message);
          }
          await waitMs(120);
        }
      }
      } finally {
        continuousLoopRunningRef.current = false;
        setContinuousListeningActive(false);
        speech.cancelRecording();
      }
    };

    void runContinuousLoop();

    return () => {
      cancelled = true;
      continuousLoopRunningRef.current = false;
      setContinuousListeningActive(false);
      speech.cancelRecording();
    };
  }, [
    activeVad,
    continuousVoiceEnabled,
    mode,
    pushConversationNotice,
    pushDiagnostic,
    speech.cancelRecording,
    speech.refreshAvailability,
    speech.recordUntilSilence,
    stopSpeaking,
  ]);

  const onMicClick = useCallback(async () => {
    const isSpeechReady = speech.available;
    if (!isSpeechReady) {
      void speech.refreshAvailability();
      const reason = speech.availabilityDetail?.reason ? ` (${speech.availabilityDetail.reason})` : '';
      pushDiagnostic(`Backend transcription non confirmé${reason}, tentative micro locale immédiate.`, 'warn');
    }

    if (continuousVoiceEnabled) {
      continuousEnabledRef.current = false;
      setContinuousVoiceEnabled(false);
      setContinuousListeningActive(false);
      speech.cancelRecording();
      pushDiagnostic('Mode continu désactivé (passage micro manuel).');
      toast.info('Mode conversation continue désactivé pour le micro manuel.');
      pushDiagnostic('Arrêt du micro continu en cours, reprise manuelle au prochain clic.', 'warn');
      pushConversationNotice('Micro en transition: reclique dans 1 seconde.', 1200);
      return;
    }

    if (!speech.isRecording) {
      try {
        void primePlayback();
        setVoiceFallbackNotice(null);
        if (isSpeakingRef.current) {
          stopSpeaking({ silent: true });
          pushDiagnostic('Ruth reprend la parole: lecture stoppée.', 'warn');
        } else {
          stopSpeaking({ silent: true });
        }
        await speech.startRecording();
        pushDiagnostic('Micro manuel démarré.');
        pushConversationNotice('Micro autorisé · enregistrement démarré', 1400);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Impossible de démarrer le micro manuel.';
        const lowered = message.toLowerCase();
        if (lowered.includes('already recording') || lowered.includes('start already in progress')) {
          pushDiagnostic('Micro déjà en transition, reclique dans 1 seconde.', 'warn');
          pushConversationNotice('Micro en transition: reclique dans 1 seconde.', 1200);
          return;
        }
        if (lowered.includes('permission')) {
          pushDiagnostic('Micro refusé par le navigateur.', 'error');
          pushConversationNotice('Micro refusé: autorise le micro dans le navigateur.', 2500);
        } else {
          pushDiagnostic('Impossible de démarrer le micro manuel.', 'error');
        }
        toast.error(err instanceof Error ? err.message : 'Impossible de démarrer le micro');
      }
      return;
    }

    try {
      const transcript = await speech.stopRecording();
      const text = transcript.trim();
      if (!text) {
        setVoiceFallbackNotice(null);
        setLastTranscript('[transcription vide]');
        pushDiagnostic('Micro manuel: aucun texte détecté.', 'warn');
        pushConversationNotice('Aucune parole détectée.', 1400);
        toast.info('Aucune phrase détectée');
        return;
      }
      setLastTranscript(text);
      pushDiagnostic('Micro manuel: transcription captée.');
      pushConversationNotice('Transcription reçue, envoi à Hermès…', 1200);
      if (mode === 'cockpit') {
        if (!handleCommandOnly(text)) {
          toast.info('Commande cockpit attendue: "retour Hermès" ou "ouvre le cockpit".');
        }
        return;
      }
      await sendToHermes(text, 'voice');
    } catch (err) {
      pushDiagnostic('Échec transcription micro manuel.', 'error');
      toast.error(err instanceof Error ? err.message : 'Transcription impossible');
    }
  }, [
    continuousVoiceEnabled,
    handleCommandOnly,
    mode,
    pushDiagnostic,
    sendToHermes,
    speech.available,
    speech.availabilityDetail,
    speech.cancelRecording,
    speech.isRecording,
    speech.refreshAvailability,
    speech.startRecording,
    speech.stopRecording,
    stopSpeaking,
  ]);

  const onSubmitDraft = useCallback(async () => {
    const text = voiceDraft.trim();
    if (!text || sending) return;
    setVoiceDraft('');
    await sendToHermes(text, 'text');
  }, [sendToHermes, sending, voiceDraft]);

  const onSubmitCockpitCommand = useCallback(() => {
    const text = cockpitCommandDraft.trim();
    if (!text) return;
    setCockpitCommandDraft('');
    if (!handleCommandOnly(text)) {
      toast.info('Commande non reconnue. Dis "retour Hermès" pour revenir à la conversation.');
    }
  }, [cockpitCommandDraft, handleCommandOnly]);

  const onToggleLocalVoice = useCallback(() => {
    setLocalVoiceEnabled((prev) => !prev);
    pushDiagnostic(`Voix locale ${!localVoiceEnabled ? 'activée' : 'désactivée'}.`);
  }, [localVoiceEnabled, pushDiagnostic]);
  const onToggleContinuousVoice = useCallback(async () => {
    if (continuousToggleGuardRef.current) return;
    continuousToggleGuardRef.current = true;
    setVoiceFallbackNotice(null);
    setConversationNotice(null);
    const next = !continuousVoiceEnabled;
    if (next) {
      const isSpeechReady = speech.available || await speech.refreshAvailability();
      if (!isSpeechReady) {
        const reason = speech.availabilityDetail?.reason || 'service STT non joignable';
        pushDiagnostic(`Impossible d’activer le mode continu: ${reason}.`, 'error');
        toast.error(`Conversation continue indisponible: ${reason}.`);
        continuousToggleGuardRef.current = false;
        return;
      }
    }
    continuousEnabledRef.current = next;
    setContinuousVoiceEnabled(next);
    if (!next) {
      setContinuousListeningActive(false);
      speech.cancelRecording();
      pushDiagnostic('Conversation continue désactivée.');
    } else {
      pushConversationNotice('Mode conversation continue activé', 1500);
      pushDiagnostic('Conversation continue activée.');
    }
    window.setTimeout(() => {
      continuousToggleGuardRef.current = false;
    }, 450);
  }, [continuousVoiceEnabled, pushConversationNotice, pushDiagnostic, speech.available, speech.cancelRecording, speech.refreshAvailability]);
  const audioLevelPercent = useMemo(() => {
    const scaled = Math.round(Math.min(100, speech.audioLevel * 4200));
    return scaled;
  }, [speech.audioLevel]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#050608' }}>
        <div className="flex items-center gap-3 text-sm" style={{ color: '#e7edf9' }}>
          <Loader2 size={18} className="animate-spin" />
          Chargement de l’interface Hermès…
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" style={{ background: '#050608' }}>
        <div className="max-w-xl rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#f4f7ff' }}>
          <div className="text-lg font-semibold mb-2">Interface Hermès indisponible</div>
          <div className="text-sm opacity-80">{error || 'Impossible de charger le cockpit.'}</div>
        </div>
      </div>
    );
  }

  if (mode === 'cockpit') {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="px-4 md:px-6 pt-4 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => returnHermes(false)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
              style={{ color: '#dce9ff', border: '1px solid rgba(150, 189, 255, 0.35)', background: 'rgba(22, 37, 65, 0.5)' }}
            >
              Retour à Hermès
            </button>
            <button
              onClick={onMicClick}
              disabled={speech.isTranscribing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60"
              style={{ color: '#051226', background: speech.isRecording ? '#f8c96e' : '#7fd7ff' }}
              title='Commande vocale: "retour Hermès"'
            >
              {speech.isRecording ? <MicOff size={16} /> : <Mic size={16} />}
              Commande vocale
            </button>
            <div className="text-xs" style={{ color: '#9fb2d5' }}>
              Dis: “retour Hermès” · “ouvre le cockpit” · “ouvre Ruth OS”
            </div>
          </div>
          <div className="flex gap-2 max-w-2xl">
            <input
              value={cockpitCommandDraft}
              onChange={(event) => setCockpitCommandDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSubmitCockpitCommand();
                }
              }}
              placeholder='Commande rapide (ex: "retour Hermès")'
              className="flex-1 rounded-xl px-3 py-2 text-sm"
              style={{ color: '#eef4ff', background: 'rgba(8, 18, 33, 0.82)', border: '1px solid rgba(120, 166, 244, 0.3)' }}
            />
            <button
              onClick={onSubmitCockpitCommand}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm"
              style={{ color: '#051226', background: '#7fd7ff' }}
            >
              <Send size={14} />
              OK
            </button>
          </div>
          {lastTranscript && (
            <div className="text-xs" style={{ color: '#8ea6cf' }}>
              Dernière transcription: {lastTranscript}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <JarvisCockpitFullView />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'radial-gradient(circle at 50% 18%, #0d1f39 0%, #050608 48%, #030407 100%)' }}>
      <style>{`
        @keyframes jarvisPulse {
          0% { transform: scale(1); opacity: 0.75; }
          50% { transform: scale(1.09); opacity: 1; }
          100% { transform: scale(1); opacity: 0.75; }
        }
        @keyframes jarvisDrift {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
          100% { transform: translateY(0px); }
        }
      `}</style>

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-10 space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: '#8ba4d1' }}>
            Jarvis Interface · Hermès Brain · Obsidian Memory
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ color: '#d9e5ff', border: '1px solid rgba(131, 173, 255, 0.3)', background: 'rgba(30, 54, 92, 0.25)' }}
            >
              <RefreshCw size={14} />
              Rafraîchir
            </button>
            <button
              onClick={() => openCockpit(false)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ color: '#051226', background: '#7fd7ff' }}
            >
              Ouvrir le cockpit
            </button>
          </div>
        </header>

        <section className="rounded-3xl px-4 md:px-8 py-8 md:py-10 text-center" style={{ border: '1px solid rgba(123, 172, 255, 0.22)', background: 'linear-gradient(180deg, rgba(12, 26, 50, 0.6), rgba(7, 12, 20, 0.45))' }}>
          <div className="mx-auto mb-6" style={{ width: 190, height: 190, position: 'relative', animation: 'jarvisDrift 3.2s ease-in-out infinite' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, rgba(168,224,255,0.95), rgba(68,145,255,0.78) 36%, rgba(26,68,166,0.48) 72%, rgba(8,15,30,0.2) 100%)', boxShadow: '0 0 42px rgba(91, 170, 255, 0.55), inset 0 0 26px rgba(255,255,255,0.15)', animation: 'jarvisPulse 2.8s ease-in-out infinite' }} />
            <div style={{ position: 'absolute', inset: -18, borderRadius: '50%', border: '1px solid rgba(104, 176, 255, 0.36)' }} />
            <div style={{ position: 'absolute', inset: -36, borderRadius: '50%', border: '1px solid rgba(104, 176, 255, 0.15)' }} />
          </div>

          <h1 className="text-xl md:text-3xl font-semibold mb-2" style={{ color: '#f4f7ff' }}>
            {HOME_GREETING}
          </h1>
          <p className="text-sm md:text-base mb-5" style={{ color: '#a9bbdc' }}>
            Ruth parle à Jarvis, Jarvis passe par Hermès, et ouvre le cockpit seulement sur demande.
          </p>

          <div
            className="max-w-2xl mx-auto mb-5 rounded-2xl px-4 py-3 text-left"
            style={{
              border: '1px solid rgba(143, 192, 255, 0.28)',
              background: 'linear-gradient(180deg, rgba(12, 24, 44, 0.84), rgba(8, 15, 28, 0.72))',
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: '#8ec7ff' }}>
                  Voix recommandee
                </div>
                <div className="text-sm font-medium mt-1" style={{ color: '#eef5ff' }}>
                  Utilise la Voix V2 isolee pour le vocal fluide valide.
                </div>
                <div className="text-xs mt-1" style={{ color: '#9cb7da' }}>
                  Cette page reste utile pour le texte et le cockpit. La voix de reference est sur le proto V2.
                </div>
              </div>
              <button
                onClick={openVoiceV2}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold"
                style={{ color: '#051226', background: '#8df0b4', boxShadow: '0 0 26px rgba(141, 240, 180, 0.18)' }}
                title="Ouvrir la voix V2 recommandee"
              >
                <ExternalLink size={16} />
                Ouvrir Voix V2
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            <button
              onClick={onMicClick}
              disabled={sending || speech.isTranscribing}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold disabled:opacity-50"
              style={{ color: '#051226', background: speech.isRecording ? '#f8c96e' : '#7fd7ff', boxShadow: '0 0 26px rgba(127, 215, 255, 0.4)' }}
              title={speech.isRecording ? 'Arrêter et transcrire' : continuousVoiceEnabled ? 'Basculer en micro manuel' : 'Parler à Hermès'}
            >
              {speech.isRecording ? <MicOff size={18} /> : <Mic size={18} />}
              {speech.isRecording ? 'Stop & Transcrire' : continuousVoiceEnabled ? 'Micro manuel' : 'Parler à Hermès'}
            </button>

            <button
              onClick={() => {
                void primePlayback();
                void speak(HOME_GREETING, localVoiceEnabled);
              }}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium"
              style={{ color: '#dce9ff', border: '1px solid rgba(150, 189, 255, 0.35)', background: 'rgba(22, 37, 65, 0.4)' }}
            >
              <Volume2 size={16} />
              Rejouer le bonjour
            </button>

            <button
              onClick={onToggleLocalVoice}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium"
              style={{
                color: localVoiceEnabled ? '#051226' : '#dce9ff',
                background: localVoiceEnabled ? '#8df0b4' : 'rgba(22, 37, 65, 0.5)',
                border: localVoiceEnabled ? 'none' : '1px solid rgba(150, 189, 255, 0.35)',
              }}
            >
              Voix locale {localVoiceEnabled ? 'ON' : 'OFF'}
            </button>

            <button
              onClick={() => { void onToggleContinuousVoice(); }}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium"
              style={{
                color: continuousVoiceEnabled ? '#051226' : '#dce9ff',
                background: continuousVoiceEnabled ? '#f6c76e' : 'rgba(22, 37, 65, 0.5)',
                border: continuousVoiceEnabled ? 'none' : '1px solid rgba(150, 189, 255, 0.35)',
              }}
            >
              Conversation continue {continuousVoiceEnabled ? 'ON' : 'OFF'}
            </button>

            <button
              onClick={() => setShowVoiceTuning((prev) => !prev)}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium"
              style={{ color: '#dce9ff', border: '1px solid rgba(150, 189, 255, 0.35)', background: 'rgba(22, 37, 65, 0.5)' }}
            >
              Réglage voix
              <ChevronDown size={15} style={{ transform: showVoiceTuning ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }} />
            </button>

            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ color: '#d6e3fb', border: '1px solid rgba(150, 189, 255, 0.28)', background: 'rgba(16, 27, 46, 0.45)' }}>
              <Waves size={14} />
              {stateLabel}
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ color: '#d6e3fb', border: '1px solid rgba(150, 189, 255, 0.28)', background: 'rgba(16, 27, 46, 0.45)' }}>
              {engineLabel}
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ color: voiceStatusTone.color, border: `1px solid ${voiceStatusTone.border}`, background: voiceStatusTone.bg }}>
              {voiceStatusText}
            </div>
            {continuousVoiceEnabled && (
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ color: '#f8dd9b', border: '1px solid rgba(246, 199, 110, 0.4)', background: 'rgba(76, 57, 23, 0.32)' }}>
                Mode continu actif
              </div>
            )}
            {waitingForSilence && (
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ color: '#fbe8b9', border: '1px solid rgba(248, 201, 110, 0.45)', background: 'rgba(90, 67, 22, 0.34)' }}>
                Attente de silence avant envoi
              </div>
            )}
          </div>

          {showVoiceTuning && (
            <div className="max-w-3xl mx-auto mb-4 text-left rounded-2xl p-4" style={{ border: '1px solid rgba(132, 171, 240, 0.28)', background: 'rgba(10, 21, 38, 0.68)' }}>
              <div className="text-xs uppercase tracking-[0.14em] mb-3" style={{ color: '#a9bfdf' }}>
                Fiabilité conversation continue
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  onClick={() => { void runAutoCalibration(); }}
                  disabled={autoCalibrating || speech.isRecording || speech.isTranscribing}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium disabled:opacity-55"
                  style={{ color: '#04203c', background: '#9fe0ff' }}
                >
                  {autoCalibrating ? <Loader2 size={12} className="animate-spin" /> : null}
                  Auto-calibrer le seuil
                </button>
                {calibrationSummary && (
                  <div className="text-[11px]" style={{ color: '#9bb5dd' }}>
                    {calibrationSummary}
                  </div>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-xs" style={{ color: '#bdd0ef' }}>
                  Profil VAD
                  <select
                    className="mt-1 w-full rounded-lg px-2.5 py-2 text-sm"
                    style={{ color: '#e7f0ff', background: 'rgba(8, 16, 29, 0.95)', border: '1px solid rgba(130, 166, 228, 0.32)' }}
                    value={vadProfileId}
                    onChange={(event) => setVadProfileId(event.target.value as VadProfileId)}
                  >
                    {Object.entries(VAD_PROFILES).map(([id, profile]) => (
                      <option key={id} value={id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="text-xs" style={{ color: '#bdd0ef' }}>
                  Seuil voix (+/-)
                  <input
                    type="range"
                    min={-0.01}
                    max={0.03}
                    step={0.001}
                    value={vadThresholdOffset}
                    onChange={(event) => setVadThresholdOffset(Number(event.target.value))}
                    className="w-full mt-2"
                  />
                  <div className="mt-1 text-[11px]" style={{ color: '#8fb0dc' }}>
                    Seuil actif: {activeVad.vadThreshold.toFixed(3)}
                  </div>
                </div>

                <div className="text-xs" style={{ color: '#bdd0ef' }}>
                  Silence avant envoi
                  <input
                    type="range"
                    min={-220}
                    max={520}
                    step={20}
                    value={silenceOffsetMs}
                    onChange={(event) => setSilenceOffsetMs(Number(event.target.value))}
                    className="w-full mt-2"
                  />
                  <div className="mt-1 text-[11px]" style={{ color: '#8fb0dc' }}>
                    {activeVad.silenceDurationMs} ms
                  </div>
                </div>

                <div className="text-xs" style={{ color: '#bdd0ef' }}>
                  Garde anti-écho après réponse
                  <input
                    type="range"
                    min={-220}
                    max={900}
                    step={20}
                    value={echoGuardOffsetMs}
                    onChange={(event) => setEchoGuardOffsetMs(Number(event.target.value))}
                    className="w-full mt-2"
                  />
                  <div className="mt-1 text-[11px]" style={{ color: '#8fb0dc' }}>
                    {activeVad.postSpeakGuardMs} ms
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="max-w-2xl mx-auto flex gap-2">
            <input
              value={voiceDraft}
              onChange={(event) => setVoiceDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void onSubmitDraft();
                }
              }}
              placeholder='Message à Hermès (ex: "ouvre le cockpit")'
              className="flex-1 rounded-2xl px-4 py-3 text-sm"
              style={{ color: '#eef4ff', background: 'rgba(8, 18, 33, 0.82)', border: '1px solid rgba(120, 166, 244, 0.3)' }}
            />
            <button
              onClick={() => void onSubmitDraft()}
              disabled={sending || !voiceDraft.trim()}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium disabled:opacity-50"
              style={{ color: '#051226', background: '#7fd7ff' }}
            >
              <Send size={14} />
              Envoyer
            </button>
          </div>

          {lastTranscript && (
            <div className="mt-4 text-xs" style={{ color: '#8ea6cf' }}>
              Dernière transcription: {lastTranscript}
            </div>
          )}
          {voiceFallbackNotice && (
            <div className="mt-3 text-xs" style={{ color: '#ffd7a1' }}>
              {voiceFallbackNotice}
            </div>
          )}
          {conversationNotice && (
            <div className="mt-3 text-xs" style={{ color: '#ffdca8' }}>
              {conversationNotice}
            </div>
          )}
          {continuousVoiceEnabled && (
            <div className="mt-2 max-w-sm mx-auto">
              <div className="text-[11px] mb-1" style={{ color: '#9db2d7' }}>
                Niveau micro en direct {audioLevelPercent}%
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(125, 171, 245, 0.25)' }}>
                <div
                  className="h-full rounded-full transition-all duration-150"
                  style={{
                    width: `${audioLevelPercent}%`,
                    background: speech.speechDetected ? '#f6c76e' : '#8dc4ff',
                  }}
                />
              </div>
            </div>
          )}
          {voiceHealth?.last_error && localVoiceEnabled && (
            <div className="mt-2 text-[11px]" style={{ color: '#f0b6b6' }}>
              Diagnostic voix: {voiceHealth.last_error}
            </div>
          )}
          {voiceDiagnostics.length > 0 && (
            <div className="mt-3 max-w-2xl mx-auto text-left rounded-xl px-3 py-2" style={{ border: '1px solid rgba(130, 164, 226, 0.24)', background: 'rgba(8, 16, 30, 0.6)' }}>
              <div className="text-[11px] uppercase tracking-[0.12em] mb-1" style={{ color: '#8faad3' }}>
                Journal vocal
              </div>
              <div className="space-y-1 max-h-[118px] overflow-y-auto pr-1">
                {voiceDiagnostics.slice().reverse().map((item) => (
                  <div key={item.id} className="text-[11px]" style={{ color: item.level === 'error' ? '#f7b0b0' : item.level === 'warn' ? '#f9dca0' : '#9ec1ef' }}>
                    [{new Date(item.at).toLocaleTimeString('fr-FR', { hour12: false })}] {item.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-4">
          <div className="rounded-3xl p-5" style={{ border: '1px solid rgba(120, 166, 244, 0.2)', background: 'rgba(9, 18, 32, 0.65)' }}>
            <div className="flex items-center gap-2 mb-4" style={{ color: '#dce9ff' }}>
              <Sparkles size={16} />
              <h2 className="text-sm uppercase tracking-[0.18em]">Priorités du jour</h2>
            </div>
            <div className="space-y-2">
              {todayPriorities.length === 0 && (
                <div className="text-sm" style={{ color: '#9eb2d6' }}>Aucune priorité n’a encore été synthétisée.</div>
              )}
              {todayPriorities.map((item, index) => (
                <div key={`${item}-${index}`} className="rounded-2xl px-3 py-3 text-sm" style={{ color: '#f5f8ff', border: '1px solid rgba(121, 166, 244, 0.24)', background: 'rgba(10, 20, 36, 0.7)' }}>
                  {index + 1}. {item}
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs" style={{ color: '#88a4cf' }}>
              Source: <code>/v1/personal-cockpit</code> ({snapshot.obsidian_action_inbox_source?.label || 'Cockpit runtime'})
            </div>
          </div>

          <div className="rounded-3xl p-5" style={{ border: '1px solid rgba(120, 166, 244, 0.2)', background: 'rgba(9, 18, 32, 0.65)' }}>
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-sm uppercase tracking-[0.18em]" style={{ color: '#dce9ff' }}>Action cards</h2>
              <span className="text-xs" style={{ color: '#8fa9d3' }}>Visibles, exécution future</span>
            </div>
            <div className="space-y-3">
              {actionCards.length === 0 && (
                <div className="text-sm" style={{ color: '#9eb2d6' }}>Aucune action en attente.</div>
              )}
              {actionCards.map((card) => {
                const tone = priorityTone(card.priority);
                return (
                  <article key={card.id} className="rounded-2xl p-4" style={{ border: `1px solid ${tone.border}`, background: 'rgba(11, 23, 42, 0.74)' }}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="text-sm font-semibold" style={{ color: '#f3f7ff' }}>{card.title}</div>
                        <div className="text-xs mt-0.5" style={{ color: '#8fa9d3' }}>{card.source} · {card.status}</div>
                      </div>
                      <span className="px-2 py-1 rounded-full text-[11px]" style={{ color: tone.color, border: `1px solid ${tone.border}`, background: 'rgba(255,255,255,0.02)' }}>
                        {tone.label}
                      </span>
                    </div>
                    <p className="text-sm mb-3" style={{ color: '#d8e4fb' }}>{card.detail}</p>
                    <div className="flex flex-wrap gap-2">
                      {['Lancer', 'Déléguer', 'Reporter'].map((label) => (
                        <button
                          key={label}
                          disabled
                          className="px-3 py-1.5 rounded-xl text-xs font-medium cursor-not-allowed opacity-65"
                          style={{ color: '#9fb4d8', border: '1px solid rgba(143, 175, 228, 0.26)', background: 'rgba(18, 33, 58, 0.62)' }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-3xl p-5" style={{ border: '1px solid rgba(120, 166, 244, 0.2)', background: 'rgba(9, 18, 32, 0.65)' }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm uppercase tracking-[0.18em]" style={{ color: '#dce9ff' }}>
              Historique conversation Hermès
            </h2>
            <div className="text-xs" style={{ color: '#8fa9d3' }}>
              {conversation.length} échange{conversation.length > 1 ? 's' : ''}
            </div>
          </div>
          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {conversation.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl px-4 py-3"
                style={{
                  background: entry.role === 'assistant' ? 'rgba(12, 30, 54, 0.76)' : 'rgba(20, 36, 60, 0.72)',
                  border: '1px solid rgba(127, 171, 245, 0.24)',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: '#86b6ff' }}>
                    {entry.role === 'assistant' ? 'Hermès' : 'Ruth'}
                  </div>
                  <div className="text-[11px]" style={{ color: '#8fa9d3' }}>
                    {entry.channel === 'voice' ? 'Vocal' : 'Texte'}
                  </div>
                </div>
                <div className="text-sm" style={{ color: '#eff5ff' }}>
                  {entry.content}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
