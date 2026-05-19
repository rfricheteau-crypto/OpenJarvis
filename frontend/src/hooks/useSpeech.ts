import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth, type SpeechHealth } from '../lib/api';

export type SpeechState = 'idle' | 'recording' | 'transcribing';
export type RecordUntilSilenceOptions = {
  silenceDurationMs?: number;
  minSpeechMs?: number;
  noSpeechTimeoutMs?: number;
  maxRecordingMs?: number;
  vadThreshold?: number;
  ignoreAudioUntilMs?: number;
  suppressNoSpeechDiagnostic?: boolean;
  armOnSpeech?: boolean;
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
};

export type AmbientLevelMetrics = {
  averageLevel: number;
  peakLevel: number;
  recommendedThreshold: number;
  sampledMs: number;
};

export type SpeechDiagnosticLevel = 'info' | 'warn' | 'error';

export type SpeechDiagnosticEvent = {
  message: string;
  level?: SpeechDiagnosticLevel;
};

type UseSpeechOptions = {
  onDiagnostic?: (event: SpeechDiagnosticEvent) => void;
};

export function useSpeech(options: UseSpeechOptions = {}) {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [availabilityDetail, setAvailabilityDetail] = useState<SpeechHealth | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [speechDetected, setSpeechDetected] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const cancellingRef = useRef(false);
  const lastBlobSizeRef = useRef(0);
  const lastMimeTypeRef = useRef<string | null>(null);
  const onDiagnosticRef = useRef(options.onDiagnostic);
  const lastDiagnosticRef = useRef<{ message: string; at: number } | null>(null);
  const lastHealthAvailabilityRef = useRef<boolean | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const healthFailureCountRef = useRef(0);
  const startingRecordingRef = useRef(false);
  const activeRecordPromiseRef = useRef<Promise<string> | null>(null);

  const clearPreparedRecorder = useCallback(() => {
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    recordingStartedAtRef.current = null;
    startingRecordingRef.current = false;
    setState('idle');
  }, []);

  useEffect(() => {
    onDiagnosticRef.current = options.onDiagnostic;
  }, [options.onDiagnostic]);

  const emitDiagnostic = useCallback((message: string, level: SpeechDiagnosticLevel = 'info') => {
    const now = Date.now();
    const last = lastDiagnosticRef.current;
    if (last && last.message === message && now - last.at < 1400) return;
    lastDiagnosticRef.current = { message, at: now };
    onDiagnosticRef.current?.({ message, level });
  }, []);

  const refreshAvailability = useCallback(async () => {
    try {
      const health = await fetchSpeechHealth();
      setAvailabilityDetail(health);
      const availableNow = Boolean(health.available);
      healthFailureCountRef.current = 0;
      setAvailable(availableNow);
      if (lastHealthAvailabilityRef.current !== availableNow) {
        if (availableNow) {
          emitDiagnostic('Transcription serveur disponible.', 'info');
        } else {
          emitDiagnostic(`Transcription serveur indisponible: ${health.reason || 'raison inconnue'}.`, 'warn');
        }
        lastHealthAvailabilityRef.current = availableNow;
      }
      return availableNow;
    } catch {
      const nextFailures = healthFailureCountRef.current + 1;
      healthFailureCountRef.current = nextFailures;
      // Avoid hard-flapping the UI on a single transient network failure.
      // Only degrade availability after repeated failures.
      if (nextFailures >= 3) {
        setAvailabilityDetail({ available: false, reason: 'Speech health request failed' });
        setAvailable(false);
        if (lastHealthAvailabilityRef.current !== false) {
          emitDiagnostic('Vérification transcription serveur impossible (réseau/API).', 'warn');
          lastHealthAvailabilityRef.current = false;
        }
      }
      // On intermittent failure, preserve the last known readiness and reason to avoid false UI blocks.
      if (nextFailures < 3) {
        return lastHealthAvailabilityRef.current ?? available;
      }
      return false;
    }
  }, [available, emitDiagnostic]);

  // Check if speech backend is available on mount and refresh periodically.
  useEffect(() => {
    void refreshAvailability();
    const timer = window.setInterval(() => {
      void refreshAvailability();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [refreshAvailability]);

  const cleanupVad = useCallback(() => {
    if (vadFrameRef.current != null) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    try {
      sourceNodeRef.current?.disconnect();
    } catch {}
    sourceNodeRef.current = null;
    analyserRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => {});
    }
    setAudioLevel(0);
    setSpeechDetected(false);
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const normalizeTranscript = useCallback((value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const alnumOnly = trimmed.replace(/[^\p{L}\p{N}]+/gu, '');
    return alnumOnly ? trimmed : '';
  }, []);

  const prepareRecorder = useCallback(async (): Promise<MediaRecorder> => {
    setError(null);
    cancellingRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone not supported in this browser');
    }

    if (startingRecordingRef.current) {
      emitDiagnostic('start_micro_skipped_already_starting', 'warn');
      throw new Error('Microphone start already in progress');
    }

    if (mediaRecorderRef.current) {
      emitDiagnostic('start_micro_skipped_already_listening', 'warn');
      throw new Error('Already recording');
    }

    startingRecordingRef.current = true;
    cleanupVad();
    stopTracks();

    let stream: MediaStream;
    try {
      emitDiagnostic('start_micro');
      emitDiagnostic('Demande permission micro…');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      emitDiagnostic('Micro autorisé.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('denied') || message.toLowerCase().includes('permission')) {
        emitDiagnostic('Micro refusé par le navigateur.', 'error');
        startingRecordingRef.current = false;
        throw new Error('Microphone permission denied');
      }
      emitDiagnostic(`Accès micro échoué: ${message || 'erreur inconnue'}.`, 'error');
      startingRecordingRef.current = false;
      throw new Error('Microphone access failed');
    }
    streamRef.current = stream;

    const preferredMimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
    ];
    const supported = preferredMimeTypes.find((type) => {
      if (typeof MediaRecorder.isTypeSupported !== 'function') return false;
      return MediaRecorder.isTypeSupported(type);
    });
    const recorder = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream);
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      // Fallback cleanup when a recording is cancelled without custom stop handler.
      stopTracks();
      cleanupVad();
      clearPreparedRecorder();
      cancellingRef.current = false;
    };

    mediaRecorderRef.current = recorder;
    startingRecordingRef.current = false;
    return recorder;
  }, [cleanupVad, clearPreparedRecorder, emitDiagnostic, stopTracks]);

  const beginRecording = useCallback(async (): Promise<MediaRecorder> => {
    const recorder = await prepareRecorder();
    recorder.start();
    recordingStartedAtRef.current = performance.now();
    setState('recording');
    emitDiagnostic(`MediaRecorder démarré (${recorder.mimeType || 'default'}).`);
    return recorder;
  }, [emitDiagnostic, prepareRecorder]);

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      await beginRecording();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone access denied';
      setError(msg);
      setState('idle');
      throw err instanceof Error ? err : new Error(msg);
    }
  }, [beginRecording]);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') {
        reject(new Error('Not recording'));
        return;
      }

      cleanupVad();
      recorder.onstop = async () => {
        stopTracks();
        startingRecordingRef.current = false;
        if (cancellingRef.current) {
          cancellingRef.current = false;
          chunksRef.current = [];
          mediaRecorderRef.current = null;
          setState('idle');
          resolve('');
          return;
        }
        setState('transcribing');

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const capturedMs = recordingStartedAtRef.current != null
          ? Math.round(performance.now() - recordingStartedAtRef.current)
          : null;
        recordingStartedAtRef.current = null;
        lastBlobSizeRef.current = blob.size;
        lastMimeTypeRef.current = blob.type || recorder.mimeType || null;
        emitDiagnostic(`audio_ready | bytes=${blob.size} | ms=${capturedMs ?? 'n/a'}`);
        emitDiagnostic(`Audio capturé: ${blob.size} bytes (${lastMimeTypeRef.current || 'audio/webm'}).`);
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        if (blob.size < 400) {
          setState('idle');
          emitDiagnostic('Audio trop court ou vide, transcription annulée.', 'warn');
          resolve('');
          return;
        }

        try {
          const transcriptionStartedAt = performance.now();
          emitDiagnostic('transcription_start');
          emitDiagnostic('Audio envoyé à /v1/speech/transcribe.');
          const result = await transcribeAudio(blob, 'recording.webm', 'fr');
          const normalizedText = normalizeTranscript(result.text);
          emitDiagnostic(`transcription_done | ms=${Math.round(performance.now() - transcriptionStartedAt)} | chars=${normalizedText.length}`);
          emitDiagnostic(`Transcription reçue: ${normalizedText.slice(0, 80)}${normalizedText.length > 80 ? '…' : ''}.`);
          setState('idle');
          resolve(normalizedText);
        } catch (err) {
          setState('idle');
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          setError(msg);
          emitDiagnostic(`Transcription erreur: ${msg}.`, 'error');
          reject(err);
        }
      };

      recorder.stop();
    });
  }, [cleanupVad, emitDiagnostic, normalizeTranscript, stopTracks]);

  const cancelRecording = useCallback((): void => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'recording') {
      cleanupVad();
      stopTracks();
      cancellingRef.current = false;
      clearPreparedRecorder();
      return;
    }
    cancellingRef.current = true;
    cleanupVad();
    recorder.stop();
  }, [cleanupVad, clearPreparedRecorder, stopTracks]);

  const recordUntilSilence = useCallback(async (options: RecordUntilSilenceOptions = {}): Promise<string> => {
    if (activeRecordPromiseRef.current) {
      return activeRecordPromiseRef.current;
    }
    const silenceDurationMs = options.silenceDurationMs ?? 900;
    const minSpeechMs = options.minSpeechMs ?? 280;
    const noSpeechTimeoutMs = options.noSpeechTimeoutMs ?? 2600;
    const maxRecordingMs = options.maxRecordingMs ?? 12000;
    const vadThreshold = options.vadThreshold ?? 0.018;
    const ignoreAudioUntilMs = Math.max(0, options.ignoreAudioUntilMs ?? 0);
    const suppressNoSpeechDiagnostic = options.suppressNoSpeechDiagnostic ?? false;
    const armOnSpeech = options.armOnSpeech ?? false;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('AudioContext unavailable for voice activity detection');
    }

    const recorder = armOnSpeech ? await prepareRecorder() : await beginRecording();
    const stopRecorderSetup = (message: string): never => {
      cancellingRef.current = true;
      if (recorder.state === 'recording') {
        recorder.stop();
      } else {
        cleanupVad();
        stopTracks();
        clearPreparedRecorder();
      }
      throw new Error(message);
    };
    const liveStream = streamRef.current;
    if (!liveStream) stopRecorderSetup('Microphone stream unavailable');

    let analyser: AnalyserNode | null = null;
    try {
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;
      const sourceNode = audioContext.createMediaStreamSource(liveStream as MediaStream);
      sourceNodeRef.current = sourceNode;
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      analyserRef.current = analyser;
      sourceNode.connect(analyser);
    } catch {
      stopRecorderSetup('AudioContext unavailable for voice activity detection');
    }
    if (!analyser) stopRecorderSetup('AudioContext unavailable for voice activity detection');
    const analyserNode = analyser as AnalyserNode;
    const buffer = new Uint8Array(analyserNode.fftSize);

    const startedAt = Date.now();
    let idleStartedAt = startedAt;
    let speechStarted = false;
    let speechStartAt = 0;
    let lastVoiceAt = 0;
    let detectedSpeechDurationMs = 0;
    let autoStopping = false;
    let recorderStarted = !armOnSpeech;
    let waitingCycles = 0;
    let pendingResolve: ((value: string) => void) | null = null;

    const safeAutoStop = () => {
      if (autoStopping) return;
      autoStopping = true;
      if (recorder.state === 'recording') recorder.stop();
    };

    const loop = () => {
      if (recorderStarted && recorder.state !== 'recording') return;
      analyserNode.getByteTimeDomainData(buffer);

      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const normalized = (buffer[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const level = Math.sqrt(sumSquares / buffer.length);
      setAudioLevel(level);
      options.onLevel?.(level);

      const now = Date.now();
      const pastIgnoreWindow = now - startedAt >= ignoreAudioUntilMs;
      const effectiveVadThreshold = !speechStarted && !recorderStarted
        ? Math.max(0.006, vadThreshold - waitingCycles * 0.002)
        : vadThreshold;
      const hasVoice = pastIgnoreWindow && level >= effectiveVadThreshold;
      if (hasVoice) {
        if (!recorderStarted) {
          emitDiagnostic('user_speech_detected');
          recorder.start();
          recorderStarted = true;
          recordingStartedAtRef.current = performance.now();
          setState('recording');
          emitDiagnostic('mic_start_success');
          emitDiagnostic(`MediaRecorder démarré (${recorder.mimeType || 'default'}).`);
        }
        lastVoiceAt = now;
        if (!speechStarted) {
          speechStarted = true;
          speechStartAt = now;
          setSpeechDetected(true);
          options.onSpeechStart?.();
        }
      }

      if (speechStarted) {
        const silenceElapsed = now - lastVoiceAt;
        const speechElapsed = now - speechStartAt;
        detectedSpeechDurationMs = Math.max(detectedSpeechDurationMs, speechElapsed);
        if (speechElapsed >= minSpeechMs && silenceElapsed >= silenceDurationMs) {
          options.onSpeechEnd?.();
          safeAutoStop();
          return;
        }
      }

      if (!speechStarted && now - idleStartedAt >= noSpeechTimeoutMs) {
        if (!recorderStarted) {
          waitingCycles += 1;
          emitDiagnostic(`continuous_waiting_for_user | threshold=${effectiveVadThreshold.toFixed(3)}`, 'info');
          idleStartedAt = now;
          vadFrameRef.current = requestAnimationFrame(loop);
          return;
        }
        safeAutoStop();
        return;
      }

      if (recorderStarted && now - startedAt >= maxRecordingMs) {
        if (speechStarted) options.onSpeechEnd?.();
        safeAutoStop();
        return;
      }

      vadFrameRef.current = requestAnimationFrame(loop);
    };

    const opPromise = new Promise<string>((resolve, reject) => {
      pendingResolve = resolve;
      recorder.onstop = async () => {
        cleanupVad();
        stopTracks();
        startingRecordingRef.current = false;
        if (cancellingRef.current) {
          cancellingRef.current = false;
          chunksRef.current = [];
          mediaRecorderRef.current = null;
          setState('idle');
          resolve('');
          return;
        }

        setState('transcribing');
        if (!recorderStarted) {
          clearPreparedRecorder();
          resolve('');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const capturedMs = recordingStartedAtRef.current != null
          ? Math.round(performance.now() - recordingStartedAtRef.current)
          : null;
        recordingStartedAtRef.current = null;
        lastBlobSizeRef.current = blob.size;
        lastMimeTypeRef.current = blob.type || recorder.mimeType || null;
        emitDiagnostic(`audio_ready | bytes=${blob.size} | ms=${capturedMs ?? 'n/a'}`);
        emitDiagnostic(`Audio capturé: ${blob.size} bytes (${lastMimeTypeRef.current || 'audio/webm'}).`);
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        if (!speechStarted || detectedSpeechDurationMs < minSpeechMs) {
          setState('idle');
          if (!suppressNoSpeechDiagnostic) {
            emitDiagnostic(`Aucune parole détectée par la VAD, transcription sautée (${capturedMs ?? 'n/a'} ms).`, 'warn');
          }
          resolve('');
          return;
        }
        if (blob.size < 400) {
          setState('idle');
          emitDiagnostic('Aucune parole exploitable détectée.', 'warn');
          resolve('');
          return;
        }

        try {
          const transcriptionStartedAt = performance.now();
          emitDiagnostic('transcription_start');
          emitDiagnostic('Audio envoyé à /v1/speech/transcribe.');
          const result = await transcribeAudio(blob, 'recording.webm', 'fr');
          const normalizedText = normalizeTranscript(result.text);
          emitDiagnostic(`transcription_done | ms=${Math.round(performance.now() - transcriptionStartedAt)} | chars=${normalizedText.length}`);
          emitDiagnostic(`Transcription reçue: ${normalizedText.slice(0, 80)}${normalizedText.length > 80 ? '…' : ''}.`);
          setState('idle');
          resolve(normalizedText);
        } catch (err) {
          setState('idle');
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          setError(msg);
          emitDiagnostic(`Transcription erreur: ${msg}.`, 'error');
          reject(err);
        }
      };

      vadFrameRef.current = requestAnimationFrame(loop);
    }).finally(() => {
      activeRecordPromiseRef.current = null;
    });

    activeRecordPromiseRef.current = opPromise;
    return opPromise;
  }, [beginRecording, cleanupVad, clearPreparedRecorder, emitDiagnostic, normalizeTranscript, prepareRecorder, stopTracks]);

  const measureAmbientLevel = useCallback(async (sampleMs = 1800): Promise<AmbientLevelMetrics> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone not supported in this browser');
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      throw new Error('Cannot calibrate while recording');
    }

    cleanupVad();
    stopTracks();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      stopTracks();
      throw new Error('AudioContext unavailable for calibration');
    }

    const audioContext = new AudioCtx();
    audioContextRef.current = audioContext;
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;
    analyserRef.current = analyser;
    sourceNode.connect(analyser);

    const frame = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(600, sampleMs);
    let total = 0;
    let frames = 0;
    let peak = 0;

    while (Date.now() < deadline) {
      analyser.getByteTimeDomainData(frame);
      let sumSquares = 0;
      for (let i = 0; i < frame.length; i += 1) {
        const normalized = (frame[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const level = Math.sqrt(sumSquares / frame.length);
      total += level;
      peak = Math.max(peak, level);
      frames += 1;
      // Keep this responsive but avoid heavy CPU loops.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 24));
    }

    const averageLevel = frames > 0 ? total / frames : 0.01;
    const recommendedThreshold = Math.max(
      0.01,
      Math.min(0.08, averageLevel + Math.max(0.004, (peak - averageLevel) * 0.55)),
    );
    cleanupVad();
    stopTracks();

    return {
      averageLevel,
      peakLevel: peak,
      recommendedThreshold,
      sampledMs: Date.now() - startedAt,
    };
  }, [cleanupVad, stopTracks]);

  useEffect(() => {
    return () => {
      try {
        cancelRecording();
      } catch {}
      cleanupVad();
      stopTracks();
    };
  }, [cancelRecording, cleanupVad, stopTracks]);

  return {
    state,
    error,
    available,
    availabilityDetail,
    audioLevel,
    speechDetected,
    startRecording,
    stopRecording,
    cancelRecording,
    recordUntilSilence,
    measureAmbientLevel,
    refreshAvailability,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
    lastBlobSize: lastBlobSizeRef.current,
    lastMimeType: lastMimeTypeRef.current,
  };
}
