import { useCallback, useEffect, useRef, useState } from 'react';

// Contrat d'intégration réel (Codex, 2026-08-31) :
// prototypes/hermes-webrtc-poc-v2/INTEGRATION_CONTRACT.md
// Ne pas inventer d'endpoint — en particulier pas de POST /interrupt : le
// barge-in est une conséquence du flux micro continu + VAD côté runtime, pas
// une requête séparée. G ouvre/ferme la session ; le runtime pilote le tour.
//
// Comportement audio calqué EXACTEMENT sur le client de référence de Codex
// (prototypes/hermes-webrtc-poc-v2/web/app.js, déjà testé par lui) après un
// test humain réel (Ruth, 2026-08-31 23h15) qui a trouvé la voix "lente,
// molle, ne comprend pas" : la première version d'ici ne réarmait jamais la
// lecture audio après une coupure (user_speaking/barge_in_start), ni le
// keepalive ping, ni la résilience aux états "disconnected" transitoires —
// contrairement à app.js qui fait les trois.
const V2_BASE_URL = 'http://127.0.0.1:8790';

export type HermesVoiceRuntimeState =
  | 'idle'
  | 'connecting'
  | 'LISTENING_ARMED'
  | 'RECORDING'
  | 'TRANSCRIBING'
  | 'THINKING'
  | 'SPEAKING'
  | 'COOLDOWN'
  | 'LISTENING_AGAIN'
  | 'closed'
  | 'error';

export type HermesVoiceMessage = { role: string; text: string; confidence?: number };

type DataChannelPayload =
  | { type: 'state'; state: string; detail?: string }
  | { type: 'message'; role: string; text: string; confidence?: number }
  | { type: 'event'; name: string; payload?: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

type UseHermesVoiceSessionOptions = {
  onMessage?: (message: HermesVoiceMessage) => void;
  onDiagnostic?: (message: string, level?: 'info' | 'warn' | 'error') => void;
};

export function useHermesVoiceSession(options: UseHermesVoiceSessionOptions = {}) {
  const [runtimeState, setRuntimeState] = useState<HermesVoiceRuntimeState>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const localVadContextRef = useRef<AudioContext | null>(null);
  const localVadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const localVadAnalyserRef = useRef<AnalyserNode | null>(null);
  const localVadFrameRef = useRef<number | null>(null);
  const localSpeechFramesRef = useRef(0);
  const localBargeMutedRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const runtimeStateRef = useRef<HermesVoiceRuntimeState>('idle');
  const onMessageRef = useRef(options.onMessage);
  const onDiagnosticRef = useRef(options.onDiagnostic);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
  }, [options.onMessage]);
  useEffect(() => {
    onDiagnosticRef.current = options.onDiagnostic;
  }, [options.onDiagnostic]);
  useEffect(() => {
    runtimeStateRef.current = runtimeState;
  }, [runtimeState]);

  const emitDiagnostic = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    onDiagnosticRef.current?.(message, level);
  }, []);

  const setRemoteTrackEnabled = useCallback((enabled: boolean) => {
    remoteStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }, []);

  // Coupe le rendu local immédiatement (contrat, section barge-in) — le
  // runtime pilote l'arrêt réel du tour côté serveur.
  const cutRemoteAudio = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    try {
      el.pause();
    } catch {}
    el.muted = true;
    setRemoteTrackEnabled(false);
    el.srcObject = null;
  }, [setRemoteTrackEnabled]);

  // Réarme la lecture au tour suivant — sans ça, une seule coupure rend la
  // voix silencieuse en permanence (bug trouvé au test humain du 2026-08-31).
  const resumeRemoteAudio = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    el.muted = false;
    setRemoteTrackEnabled(true);
    if (!el.srcObject && remoteStreamRef.current) {
      el.srcObject = remoteStreamRef.current;
    }
    void el.play().catch(() => {});
  }, [setRemoteTrackEnabled]);

  // The server remains authoritative for the conversational turn.  This tiny
  // local VAD only mutes remote playback at the first audible interruption,
  // avoiding a server/VAD/data-channel round trip before Ruth hears silence.
  const startLocalBargeMonitor = useCallback((stream: MediaStream) => {
    if (!window.AudioContext) return;
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      localVadContextRef.current = context;
      localVadSourceRef.current = source;
      localVadAnalyserRef.current = analyser;
      const samples = new Uint8Array(analyser.fftSize);
      const monitor = () => {
        analyser.getByteTimeDomainData(samples);
        let squareSum = 0;
        for (const sample of samples) {
          const value = (sample - 128) / 128;
          squareSum += value * value;
        }
        const rms = Math.sqrt(squareSum / samples.length);
        if (runtimeStateRef.current === 'SPEAKING' && rms >= 0.035) {
          localSpeechFramesRef.current += 1;
          if (localSpeechFramesRef.current >= 4 && !localBargeMutedRef.current) {
            localBargeMutedRef.current = true;
            cutRemoteAudio();
            emitDiagnostic('voice_local_barge_audio_cut');
          }
        } else {
          localSpeechFramesRef.current = 0;
        }
        localVadFrameRef.current = window.requestAnimationFrame(monitor);
      };
      void context.resume().catch(() => {});
      localVadFrameRef.current = window.requestAnimationFrame(monitor);
    } catch {
      emitDiagnostic('voice_local_barge_unavailable', 'warn');
    }
  }, [cutRemoteAudio, emitDiagnostic]);

  const teardown = useCallback(() => {
    if (pingTimerRef.current != null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (localVadFrameRef.current != null) {
      window.cancelAnimationFrame(localVadFrameRef.current);
      localVadFrameRef.current = null;
    }
    localSpeechFramesRef.current = 0;
    localBargeMutedRef.current = false;
    try {
      localVadSourceRef.current?.disconnect();
      localVadAnalyserRef.current?.disconnect();
    } catch {}
    localVadSourceRef.current = null;
    localVadAnalyserRef.current = null;
    const localVadContext = localVadContextRef.current;
    localVadContextRef.current = null;
    if (localVadContext && localVadContext.state !== 'closed') {
      void localVadContext.close().catch(() => {});
    }
    try {
      dcRef.current?.close();
    } catch {}
    dcRef.current = null;
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    remoteStreamRef.current = null;
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
      } catch {}
      audioElRef.current.srcObject = null;
    }
  }, []);

  const endSession = useCallback(() => {
    manualDisconnectRef.current = true;
    teardown();
    setRuntimeState('idle');
    setDetail(null);
  }, [teardown]);

  const handleDataChannelMessage = useCallback(
    (raw: string) => {
      // "ping:<timestamp>" est un keepalive facultatif, pas du JSON — ignoré.
      let payload: DataChannelPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (payload.type === 'state' && typeof (payload as { state?: unknown }).state === 'string') {
        setRuntimeState((payload as { state: string }).state as HermesVoiceRuntimeState);
        setDetail(typeof (payload as { detail?: unknown }).detail === 'string' ? (payload as { detail: string }).detail : null);
        return;
      }
      if (payload.type === 'message') {
        const role = typeof (payload as { role?: unknown }).role === 'string' ? (payload as { role: string }).role : 'assistant';
        const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text : '';
        const confidence = typeof (payload as { confidence?: unknown }).confidence === 'number' ? (payload as { confidence: number }).confidence : undefined;
        if (text) onMessageRef.current?.({ role, text, confidence });
        return;
      }
      if (payload.type === 'event') {
        const name = typeof (payload as { name?: unknown }).name === 'string' ? (payload as { name: string }).name : 'unknown';
        emitDiagnostic(`voice_event:${name}`);
        if (name === 'user_speaking' && audioElRef.current?.srcObject) {
          cutRemoteAudio();
        } else if (name === 'barge_in_start') {
          cutRemoteAudio();
        } else if (name === 'audio_play_start') {
          localBargeMutedRef.current = false;
          localSpeechFramesRef.current = 0;
          resumeRemoteAudio();
        }
      }
    },
    [cutRemoteAudio, resumeRemoteAudio, emitDiagnostic],
  );

  const startSession = useCallback(
    async (sessionId: string) => {
      if (pcRef.current) return; // session déjà active — un seul bouton, pas de double ouverture
      manualDisconnectRef.current = false;
      setError(null);
      setRuntimeState('connecting');
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Microphone non supporté par ce navigateur');
        }
        emitDiagnostic('voice_session_start');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        startLocalBargeMonitor(stream);

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          const [stream0] = event.streams;
          if (!stream0 || stream0 === remoteStreamRef.current) return;
          remoteStreamRef.current = stream0;
          if (!audioElRef.current) return;
          audioElRef.current.srcObject = stream0;
          void audioElRef.current.play().catch(() => {});
        };

        // Résilience aux coupures ICE transitoires (Wi-Fi/local dev) —
        // calqué sur app.js : "disconnected" laisse 2s de grâce avant de
        // considérer la session vraiment perdue, "failed"/"closed" nettoient
        // tout de suite. Sans ça une micro-coupure réseau tuait la session
        // silencieusement, sans que G ne le signale.
        pc.onconnectionstatechange = () => {
          emitDiagnostic(`voice_connection_state:${pc.connectionState}`);
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            teardown();
            setRuntimeState(manualDisconnectRef.current ? 'idle' : 'error');
            if (!manualDisconnectRef.current) setError('Connexion vocale perdue.');
            return;
          }
          if (pc.connectionState === 'disconnected') {
            if (manualDisconnectRef.current) {
              teardown();
              setRuntimeState('idle');
              return;
            }
            window.setTimeout(() => {
              if (pcRef.current === pc && pc.connectionState === 'disconnected') {
                teardown();
                setRuntimeState('error');
                setError('Connexion vocale perdue.');
              }
            }, 2000);
          }
        };

        const dc = pc.createDataChannel('hermes-events');
        dcRef.current = dc;
        dc.onopen = () => {
          dc.send(JSON.stringify({ type: 'client-ready' }));
          emitDiagnostic('voice_data_channel_open');
          // Keepalive facultatif côté contrat, mais présent dans le client de
          // référence de Codex déjà validé — gardé pour rester sur un
          // comportement prouvé plutôt qu'en inventer un nouveau.
          pingTimerRef.current = window.setInterval(() => {
            if (dcRef.current?.readyState === 'open') dcRef.current.send(`ping:${Date.now()}`);
          }, 2000);
        };
        dc.onmessage = (event) => handleDataChannelMessage(event.data as string);
        dc.onerror = () => emitDiagnostic('voice_data_channel_error', 'error');
        dc.onclose = () => emitDiagnostic('voice_data_channel_closed');

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await fetch(`${V2_BASE_URL}/api/offer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdp: offer.sdp, type: offer.type, session_id: sessionId }),
        });
        if (!res.ok) throw new Error(`Session vocale refusée par le runtime (${res.status})`);
        const answer = (await res.json()) as { sdp: string; type: RTCSdpType };
        await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });

        setRuntimeState('LISTENING_ARMED');
        emitDiagnostic('voice_session_connected');
      } catch (err) {
        teardown();
        const message = err instanceof Error ? err.message : 'Connexion vocale impossible';
        setError(message);
        setRuntimeState('error');
        emitDiagnostic(`voice_session_error:${message}`, 'error');
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [emitDiagnostic, handleDataChannelMessage, startLocalBargeMonitor, teardown],
  );

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      teardown();
    };
  }, [teardown]);

  return {
    runtimeState,
    detail,
    error,
    audioElRef,
    startSession,
    endSession,
    isActive: runtimeState !== 'idle' && runtimeState !== 'closed' && runtimeState !== 'error',
  };
}
