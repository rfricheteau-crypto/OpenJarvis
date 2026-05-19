from __future__ import annotations

import asyncio
import difflib
import re
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    OutputTransportMessageUrgentFrame,
    StartFrame,
    UserSpeakingFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from .audio_utils import pcm_to_wav_bytes, wav_duration_seconds, wav_to_transport_frames
from .config import CONFIG
from .hermes_bridge import HermesBridge
from .models import ChatTurn, HermesProxyRequest

HOME_GREETING = "Bonjour Ruth, qu’est-ce qu’on fait aujourd’hui ?"
TRANSCRIPT_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    (r"\bhermes\b", "Hermès"),
    (r"\bjarvis\b", "Jarvis"),
    (r"\bruth os\b", "Ruth OS"),
    (r"\bgraphify\b", "Graphify"),
    (r"\bobsidian\b", "Obsidian"),
    (r"\bcock pit\b", "cockpit"),
    (r"\btabletop\b", "tableau de bord"),
)
COMMAND_CORRECTIONS: tuple[tuple[str, str], ...] = (
    (r"^gros le cockpit[.!? ]*$", "ouvre le cockpit"),
    (r"^c['’]est pour le cockpit[.!? ]*$", "ouvre le cockpit"),
    (r"^petit[.!? ]*$", "retour Hermès"),
    (r"^rembre le cockpit[.!? ]*$", "ouvre le cockpit"),
    (r"^le cockpit[.!? ]*$", "ouvre le cockpit"),
    (r"^regarde le cockpit[.!? ]*$", "ouvre le cockpit"),
    (r"^rentre herm[eè]s[.!? ]*$", "retour Hermès"),
)


def _ascii_fold(text: str) -> str:
    return ''.join(
        char for char in unicodedata.normalize('NFKD', text) if not unicodedata.combining(char)
    ).lower()


def _tokenize_command_text(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", _ascii_fold(text))


def _similarity(left: str, right: str) -> float:
    return difflib.SequenceMatcher(a=left, b=right).ratio()


def _has_similar_token(tokens: list[str], expected: set[str], *, threshold: float) -> bool:
    for token in tokens:
        if token in expected:
            return True
        if len(token) >= 4 and any(_similarity(token, candidate) >= threshold for candidate in expected):
            return True
    return False


def _matches_command_phrase(text: str, phrases: tuple[str, ...], *, threshold: float) -> bool:
    folded = _ascii_fold(text)
    for phrase in phrases:
        if phrase in folded:
            return True
        if _similarity(folded, phrase) >= threshold:
            return True
    return False


def _normalize_transcript(text: str) -> str:
    normalized = text.strip()
    # Keep transcript display faithful in simple mode; command rewriting is reserved
    # for explicit command-mode detection only.
    normalized = re.sub(r"\s+([?.!,;:])", r"\1", normalized)
    return normalized.strip()


def _detect_local_command(text: str) -> str | None:
    value = text.strip()
    if not value:
        return None

    folded = _ascii_fold(value)
    tokens = _tokenize_command_text(value)
    if not tokens:
        return None

    cockpit_phrases = (
        'ouvre le cockpit',
        'ouvre mon cockpit',
        'montre moi le cockpit',
        'montre le cockpit',
        'regarde le cockpit',
        'le cockpit',
        'cockpit',
    )
    return_phrases = (
        'retour hermes',
        'reviens hermes',
        'revient hermes',
        'rentre hermes',
        'retour vers hermes',
    )

    has_cockpit_word = _has_similar_token(
        tokens,
        {'cockpit', 'cockpites', 'copit', 'cocpit', 'cockpite'},
        threshold=0.72,
    )
    has_open_verb = _has_similar_token(
        tokens,
        {'ouvre', 'ouvrir', 'montre', 'affiche', 'lance'},
        threshold=0.7,
    )
    if _matches_command_phrase(value, cockpit_phrases, threshold=0.7):
        return 'open_cockpit'
    if has_cockpit_word and (has_open_verb or len(tokens) <= 3 or folded.endswith('cockpit')):
        return 'open_cockpit'

    has_hermes_word = _has_similar_token(
        tokens,
        {'hermes', 'herme', 'hermez', 'ermes'},
        threshold=0.72,
    )
    has_return_verb = _has_similar_token(
        tokens,
        {'retour', 'reviens', 'revient', 'rentre', 'retourne'},
        threshold=0.68,
    )
    if _matches_command_phrase(value, return_phrases, threshold=0.68):
        return 'return_hermes'
    if has_hermes_word and has_return_verb:
        return 'return_hermes'
    return None


@dataclass
class VoiceTurnMetrics:
    turn_id: str
    started_at: float = field(default_factory=time.perf_counter)
    speech_detected_ms: int | None = None
    recording_stop_ms: int | None = None
    stt_done_ms: int | None = None
    hermes_done_ms: int | None = None
    tts_done_ms: int | None = None
    audio_play_end_ms: int | None = None


class HermesVoiceProcessor(FrameProcessor):
    def __init__(
        self,
        *,
        bridge: HermesBridge,
        session_id: str,
        interrupt_output: Any | None = None,
        **kwargs: Any,
    ):
        super().__init__(**kwargs)
        self._bridge = bridge
        self._session_id = session_id
        self._interrupt_output = interrupt_output
        self._history: list[ChatTurn] = []
        self._capturing = False
        self._processing = False
        self._speaking = False
        self._phase = 'LISTENING_ARMED'
        self._speech_seen = False
        self._audio_buffer = bytearray()
        self._sample_rate = 16000
        self._channels = 1
        self._current_turn: VoiceTurnMetrics | None = None
        self._last_speaking_notice = 0.0
        self._assistant_task: asyncio.Task | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self._set_state('LISTENING_ARMED', detail='Session WebRTC prête')
        elif isinstance(frame, VADUserStartedSpeakingFrame):
            if self._speaking or self._phase in {'THINKING', 'COOLDOWN'}:
                await self._begin_barge_in('assistant_busy')
            elif self._processing:
                await self._emit_event('barge_in_ignored', {'reason': 'assistant_processing'})
            else:
                await self._start_capture()
        elif isinstance(frame, UserSpeakingFrame):
            now = time.monotonic()
            if now - self._last_speaking_notice > 0.35:
                self._last_speaking_notice = now
                await self._emit_event('user_speaking', {})
        elif isinstance(frame, InputAudioRawFrame):
            if self._capturing and not self._processing:
                self._sample_rate = frame.sample_rate
                self._channels = frame.num_channels
                self._audio_buffer.extend(frame.audio)
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            if self._capturing and not self._processing and self._audio_buffer:
                self._capturing = False
                self._processing = True
                if self._current_turn:
                    self._current_turn.recording_stop_ms = int((time.perf_counter() - self._current_turn.started_at) * 1000)
                captured = bytes(self._audio_buffer)
                self._audio_buffer.clear()
                self._assistant_task = asyncio.create_task(
                    self._handle_turn(captured, self._sample_rate, self._channels, self._current_turn),
                    name=f'hermes-turn-{self._session_id}',
                )

        await self.push_frame(frame, direction)

    async def greet(self) -> None:
        if self._history:
            return
        self._history.append(ChatTurn(role='assistant', content=HOME_GREETING))
        await self._emit_message('assistant', HOME_GREETING)
        self._speaking = True
        await self._set_state('SPEAKING', detail='Hermès parle')
        try:
            speak_data, wav_bytes = await self._bridge.speak_kokoro(HOME_GREETING)
            await self._emit_event('tts_request_done', {'engine': speak_data.get('engine_used'), 'elapsed_ms': speak_data.get('elapsed_ms')})
            await self._play_tts_audio(wav_bytes)
        finally:
            self._speaking = False
            await self._set_state('LISTENING_AGAIN', detail='Écoute relancée')

    async def _handle_turn(self, captured_audio: bytes, sample_rate: int, channels: int, turn: VoiceTurnMetrics | None) -> None:
        try:
            await self._set_state('TRANSCRIBING', detail='Transcription en cours')
            wav_bytes = pcm_to_wav_bytes(captured_audio, sample_rate, channels)
            stt_data = await self._bridge.transcribe_wav(
                wav_bytes,
                language=CONFIG.speech_language,
                prompt=CONFIG.speech_prompt,
            )
            transcript = _normalize_transcript(str(stt_data.get('text') or '').strip())
            confidence = stt_data.get('confidence')
            if turn:
                turn.stt_done_ms = int((time.perf_counter() - turn.started_at) * 1000)
            await self._emit_event('transcription_request_done', {
                'turn_id': turn.turn_id if turn else None,
                'text': transcript,
                'confidence': confidence,
                'duration_seconds': stt_data.get('duration_seconds'),
            })
            if not transcript:
                await self._set_state('LISTENING_AGAIN', detail='Aucune parole comprise')
                return

            self._history.append(ChatTurn(role='user', content=transcript))
            await self._emit_message('user', transcript, confidence=confidence)
            local_command = _detect_local_command(transcript) if CONFIG.enable_local_commands else None
            if local_command:
                await self._handle_local_command(local_command, transcript, turn)
                return
            await self._set_state('THINKING', detail='Hermès réfléchit')
            hermes_data = await self._bridge.chat(
                HermesProxyRequest(
                    message=transcript,
                    history=self._history[-6:],
                    engine_mode=CONFIG.hermes_engine_mode,
                    session_id=self._session_id,
                )
            )
            reply = str(hermes_data.get('reply') or '').strip() or 'Je suis prête pour la suite.'
            if turn:
                turn.hermes_done_ms = int((time.perf_counter() - turn.started_at) * 1000)
            self._history.append(ChatTurn(role='assistant', content=reply))
            await self._emit_event('hermes_response_done', {
                'turn_id': turn.turn_id if turn else None,
                'engine': hermes_data.get('engine'),
                'provider': hermes_data.get('provider'),
                'model': hermes_data.get('model'),
            })
            await self._emit_message('assistant', reply)
            self._speaking = True
            await self._set_state('SPEAKING', detail='Hermès parle')
            speak_data, reply_wav = await self._bridge.speak_kokoro(reply)
            if turn:
                turn.tts_done_ms = int((time.perf_counter() - turn.started_at) * 1000)
            await self._emit_event('tts_request_done', {
                'turn_id': turn.turn_id if turn else None,
                'engine': speak_data.get('engine_used'),
                'elapsed_ms': speak_data.get('elapsed_ms'),
                'speed': speak_data.get('speed'),
            })
            await self._play_tts_audio(reply_wav, turn=turn)
            self._speaking = False
            await self._set_state('COOLDOWN', detail='Anti-écho')
            await asyncio.sleep(0.7)
            await self._set_state('LISTENING_AGAIN', detail='Écoute relancée')
        except asyncio.CancelledError:
            self._speaking = False
            await self._emit_event('assistant_turn_cancelled', {'turn_id': turn.turn_id if turn else None})
            raise
        except Exception as exc:
            logger.exception('Hermès WebRTC turn failed')
            self._speaking = False
            await self._emit_event('error', {'message': str(exc)})
            await self._set_state('LISTENING_AGAIN', detail='Erreur de tour, écoute relancée')
        finally:
            self._processing = False
            self._capturing = False
            self._speech_seen = False
            self._audio_buffer.clear()
            self._assistant_task = None

    async def cancel_assistant_task(self) -> None:
        task = self._assistant_task
        if not task or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _start_capture(self) -> None:
        self._capturing = True
        self._speech_seen = True
        self._audio_buffer.clear()
        self._current_turn = VoiceTurnMetrics(turn_id=str(uuid4()))
        self._current_turn.speech_detected_ms = 0
        await self._set_state('RECORDING', detail='Ruth parle')
        await self._emit_event('user_speech_detected', {'turn_id': self._current_turn.turn_id})

    async def _begin_barge_in(self, reason: str) -> None:
        await self._emit_event('barge_in_start', {'reason': reason, 'phase': self._phase})
        if self._interrupt_output:
            interrupted = self._interrupt_output()
            await self._emit_event('audio_output_interrupted', {'interrupted': bool(interrupted)})
        await self.cancel_assistant_task()
        self._processing = False
        self._speaking = False
        await self._start_capture()

    async def _set_state(self, state: str, detail: str | None = None) -> None:
        self._phase = state
        await self._emit_state(state, detail)

    async def _handle_local_command(
        self,
        command: str,
        transcript: str,
        turn: VoiceTurnMetrics | None,
    ) -> None:
        if command == 'open_cockpit':
            reply = "D’accord Ruth, j’ouvre le cockpit."
            await self._emit_event(
                'command',
                {
                    'action': 'open_cockpit',
                    'url': f'{CONFIG.jarvis_frontend_url}?mode=cockpit',
                    'transcript': transcript,
                },
            )
        elif command == 'return_hermes':
            reply = "Je reviens à Hermès."
            await self._emit_event(
                'command',
                {
                    'action': 'return_hermes',
                    'url': f'{CONFIG.jarvis_frontend_url}?mode=hermes',
                    'transcript': transcript,
                },
            )
        else:
            return

        self._history.append(ChatTurn(role='assistant', content=reply))
        await self._emit_message('assistant', reply)
        self._speaking = True
        await self._set_state('SPEAKING', detail='Hermès exécute une commande')
        speak_data, reply_wav = await self._bridge.speak_kokoro(reply)
        if turn:
            turn.hermes_done_ms = int((time.perf_counter() - turn.started_at) * 1000)
            turn.tts_done_ms = turn.hermes_done_ms
        await self._emit_event(
            'tts_request_done',
            {
                'turn_id': turn.turn_id if turn else None,
                'engine': speak_data.get('engine_used'),
                'elapsed_ms': speak_data.get('elapsed_ms'),
                'speed': speak_data.get('speed'),
                'command': command,
            },
        )
        await self._play_tts_audio(reply_wav, turn=turn, command=command)
        self._speaking = False
        await self._set_state('COOLDOWN', detail='Anti-écho')
        await asyncio.sleep(0.7)
        await self._set_state('LISTENING_AGAIN', detail='Écoute relancée')

    async def _play_tts_audio(
        self,
        wav_bytes: bytes,
        *,
        turn: VoiceTurnMetrics | None = None,
        command: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {'engine': 'kokoro'}
        if turn:
            payload['turn_id'] = turn.turn_id
        if command:
            payload['command'] = command

        await self._emit_event('audio_play_start', payload)
        transport_frames = wav_to_transport_frames(wav_bytes)
        frame_duration_s = 0.02
        playback_started = time.perf_counter()
        for transport_frame in transport_frames:
            await self.push_frame(transport_frame, FrameDirection.DOWNSTREAM)
            await asyncio.sleep(frame_duration_s)

        remaining = max(0.0, wav_duration_seconds(wav_bytes) - (time.perf_counter() - playback_started))
        if remaining:
            await asyncio.sleep(remaining)
        if turn:
            turn.audio_play_end_ms = int((time.perf_counter() - turn.started_at) * 1000)
        await self._emit_event('audio_play_end', payload)

    async def _emit_state(self, state: str, detail: str | None = None) -> None:
        await self.push_frame(
            OutputTransportMessageUrgentFrame(
                message={
                    'type': 'state',
                    'state': state,
                    'detail': detail,
                    'session_id': self._session_id,
                    'ts': time.time(),
                }
            ),
            FrameDirection.DOWNSTREAM,
        )

    async def _emit_message(self, role: str, text: str, confidence: float | None = None) -> None:
        await self.push_frame(
            OutputTransportMessageUrgentFrame(
                message={
                    'type': 'message',
                    'role': role,
                    'text': text,
                    'confidence': confidence,
                    'session_id': self._session_id,
                    'ts': time.time(),
                }
            ),
            FrameDirection.DOWNSTREAM,
        )

    async def _emit_event(self, name: str, payload: dict[str, Any]) -> None:
        await self.push_frame(
            OutputTransportMessageUrgentFrame(
                message={
                    'type': 'event',
                    'name': name,
                    'payload': payload,
                    'session_id': self._session_id,
                    'ts': time.time(),
                }
            ),
            FrameDirection.DOWNSTREAM,
        )


class HermesWebRTCSession:
    def __init__(self, *, session_id: str, on_close: Any | None = None):
        self.session_id = session_id
        self._on_close = on_close
        self._greeted = False
        self.connection = SmallWebRTCConnection()
        self.bridge = HermesBridge()
        self.transport = SmallWebRTCTransport(
            self.connection,
            TransportParams(
                audio_in_enabled=True,
                audio_in_sample_rate=16000,
                audio_out_enabled=True,
                audio_out_sample_rate=24000,
                audio_out_channels=1,
                audio_out_auto_silence=True,
            ),
        )
        self.vad = VADProcessor(
            vad_analyzer=SileroVADAnalyzer(
                sample_rate=16000,
                params=VADParams(confidence=0.58, start_secs=0.14, stop_secs=0.5, min_volume=0.32),
            )
        )
        self.processor = HermesVoiceProcessor(
            bridge=self.bridge,
            session_id=session_id,
            interrupt_output=self._interrupt_audio_output,
        )
        self.pipeline = Pipeline([
            self.transport.input(),
            self.vad,
            self.processor,
            self.transport.output(),
        ])
        self.task = PipelineTask(
            self.pipeline,
            params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=24000),
            enable_turn_tracking=False,
            enable_rtvi=False,
            idle_timeout_secs=None,
        )
        self.runner = PipelineRunner(handle_sigint=False, handle_sigterm=False)
        self.runner_task: asyncio.Task | None = None
        self._closed = False

        @self.transport.event_handler('on_client_connected')
        async def _on_client_connected(transport, client):
            await self.processor._emit_event('client_connected', {'pc_id': client.pc_id})

        @self.transport.event_handler('on_client_disconnected')
        async def _on_client_disconnected(transport, client):
            await self.processor._emit_event('client_disconnected', {'pc_id': client.pc_id})
            await self.close()

        @self.transport.event_handler('on_app_message')
        async def _on_client_message(transport, message, client):
            await self.processor._emit_event('client_message', {'message': message, 'pc_id': client})
            if (
                isinstance(message, dict)
                and message.get('type') == 'client-ready'
                and not self._greeted
                and not self._closed
            ):
                self._greeted = True
                self.processor._assistant_task = asyncio.create_task(
                    self.processor.greet(),
                    name=f'hermes-greet-{self.session_id}',
                )

    async def initialize(self, sdp: str, type_: str) -> dict[str, Any]:
        await self.connection.initialize(sdp, type_)
        await self.start()
        answer = self.connection.get_answer()
        if not answer:
            raise RuntimeError('Missing WebRTC answer')
        answer['session_id'] = self.session_id
        return answer

    async def start(self) -> None:
        if self.runner_task and not self.runner_task.done():
            return
        self.runner_task = asyncio.create_task(self.runner.run(self.task), name=f'hermes-webrtc-{self.session_id}')

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self.processor.cancel_assistant_task()
        try:
            await self.connection.disconnect()
        except Exception:
            pass
        try:
            await self.task.cancel()
        except Exception:
            pass
        if self.runner_task:
            try:
                await asyncio.wait_for(self.runner_task, timeout=5)
            except Exception:
                self.runner_task.cancel()
        if self._on_close:
            callback = self._on_close
            self._on_close = None
            result = callback(self.session_id)
            if asyncio.iscoroutine(result):
                await result

    def _interrupt_audio_output(self) -> bool:
        try:
            output_transport = self.transport.output()
            client = getattr(output_transport, '_client', None)
            track = getattr(client, '_audio_output_track', None)
            queue = getattr(track, '_chunk_queue', None)
            if queue is None:
                return False
            interrupted = False
            while queue:
                _chunk, future = queue.popleft()
                if future and not future.done():
                    future.set_result(False)
                interrupted = True
            return interrupted
        except Exception:
            logger.exception('Failed to interrupt audio output queue')
            return False
