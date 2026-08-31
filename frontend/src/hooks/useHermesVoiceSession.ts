import { useCallback, useEffect, useRef, useState } from 'react';

// Contrat d'intégration réel (Codex, 2026-08-31) :
// prototypes/hermes-webrtc-poc-v2/INTEGRATION_CONTRACT.md
// Ne pas inventer d'endpoint — en particulier pas de POST /interrupt : le
// barge-in est une conséquence du flux micro continu + VAD côté runtime, pas
// une requête séparée. G ouvre/ferme la session ; le runtime pilote le tour.
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
  const onMessageRef = useRef(options.onMessage);
  const onDiagnosticRef = useRef(options.onDiagnostic);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
  }, [options.onMessage]);
  useEffect(() => {
    onDiagnosticRef.current = options.onDiagnostic;
  }, [options.onDiagnostic]);

  const emitDiagnostic = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    onDiagnosticRef.current?.(message, level);
  }, []);

  const teardown = useCallback(() => {
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
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
    }
  }, []);

  const endSession = useCallback(() => {
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
        // Coupure locale immédiate du rendu audio — le runtime pilote l'arrêt
        // réel du tour et la reprise d'écoute (contrat, section barge-in).
        if ((name === 'user_speaking' || name === 'barge_in_start') && audioElRef.current) {
          audioElRef.current.pause();
        }
      }
    },
    [emitDiagnostic],
  );

  const startSession = useCallback(
    async (sessionId: string) => {
      if (pcRef.current) return; // session déjà active — un seul bouton, pas de double ouverture
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

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          if (!audioElRef.current) return;
          audioElRef.current.srcObject = event.streams[0] ?? null;
          void audioElRef.current.play().catch(() => {});
        };

        const dc = pc.createDataChannel('hermes-events');
        dcRef.current = dc;
        dc.onopen = () => {
          dc.send(JSON.stringify({ type: 'client-ready' }));
          emitDiagnostic('voice_data_channel_open');
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
    [emitDiagnostic, handleDataChannelMessage, teardown],
  );

  useEffect(() => () => teardown(), [teardown]);

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
