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
SPOKEN_REPLY_MAX_CHARS = 260
SPOKEN_LIST_REPLY_MAX_CHARS = 420
SPOKEN_REPLY_MAX_SENTENCES = 3
SPOKEN_REPLY_MIN_CHARS = 60
TTS_SPEED = 1.14
POST_SPEAK_COOLDOWN_SECONDS = 0.75
BARGE_IN_ECHO_MAX_DURATION_SECONDS = 1.2
BARGE_IN_AUDIO_SETTLE_SECONDS = 0.18
BARGE_IN_TRANSCRIPT_GUARD_MS = 1400
BARGE_IN_ACCEPT_AFTER_AUDIO_END_MS = 700
BARGE_IN_SHORT_TRANSCRIPT_MAX_CHARS = 12
BARGE_IN_SHORT_TRANSCRIPT_MAX_TOKENS = 2
MIN_CAPTURED_AUDIO_SECONDS = 0.28
CAPTURE_PREROLL_SECONDS = 0.32
BARGE_IN_INTERRUPT_HINT = (
    "Interruption utilisateur prioritaire. "
    "Si Ruth coupe la voix, privilégier les mots courts réellement prononcés: "
    "non, attends, stop, coupe, chut, tais-toi, non attends. "
    "Ne pas recopier la phrase précédemment dite par l'assistant."
)
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
    normalized = re.sub(r"(?i)^c['’]est-ce qu['’]", "Qu'est-ce qu'", normalized)
    normalized = re.sub(r"(?i)^c['’]est-ce qu([aeiouyh])", r"Qu'est-ce qu\1", normalized)
    normalized = re.sub(r"(?i)^c['’]est-ce que", "Qu'est-ce que", normalized)
    normalized = re.sub(r"(?i)^c['’]est qu['’]", "Qu'est-ce qu'", normalized)
    normalized = re.sub(r"\s+([?.!,;:])", r"\1", normalized)
    return normalized.strip()


def _compact_reply_for_voice(text: str) -> str:
    def strip_greeting_prefix(sentence: str) -> str:
        lowered = _ascii_fold(sentence)
        prefixes = (
            "bonjour ruth",
            "salut ruth",
            "coucou ruth",
            "bonjour",
            "salut",
            "coucou",
        )
        for prefix in prefixes:
            if lowered.startswith(prefix):
                remainder = sentence[len(prefix):].lstrip(" ,:;!-")
                return remainder or sentence
        return sentence

    def ensure_sentence(text_value: str) -> str:
        value = text_value.strip()
        if not value:
            return value
        if value.endswith((':', ';', ',', '-', '1.', '2.', '3.')):
            return value.rstrip(' :;,-1234567890.') + '.'
        if value[-1] not in '.!?':
            return f'{value}.'
        return value

    def trim_voice_text(text_value: str, *, max_chars: int = SPOKEN_REPLY_MAX_CHARS) -> str:
        value = text_value.strip()
        if len(value) <= max_chars:
            return ensure_sentence(value)

        boundaries = [
            match.end()
            for match in re.finditer(r'(?<!\d)[.!?](?:\s|$)', value)
        ]
        before_limit = [pos for pos in boundaries if SPOKEN_REPLY_MIN_CHARS <= pos <= max_chars]
        if before_limit:
            return ensure_sentence(value[: before_limit[-1]].strip())

        after_limit = [
            pos for pos in boundaries
            if max_chars < pos <= max_chars + 160
        ]
        if after_limit:
            return ensure_sentence(value[: after_limit[0]].strip())

        truncated = value[:max_chars].rsplit(" ", 1)[0].strip()
        if not truncated:
            truncated = value[:max_chars].strip()
        return ensure_sentence(truncated)

    cleaned = text.strip()
    if not cleaned:
        return "Je suis prête pour la suite."
    cleaned = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', cleaned)
    cleaned = re.sub(r'[`*_>#]+', '', cleaned)
    cleaned = re.sub(r'\r', '', cleaned)
    cleaned = re.sub(r'[ \t]+', ' ', cleaned)
    cleaned = re.sub(r'\n{2,}', '\n', cleaned).strip()

    list_matches = list(re.finditer(r'(?:(?<=^)|(?<=\n)|(?<=\s))(\d+)\.\s+', cleaned))
    if list_matches:
        preface = cleaned[: list_matches[0].start()].strip(" \n:;-")
        items: list[str] = []
        for index, match in enumerate(list_matches):
            end = list_matches[index + 1].start() if index + 1 < len(list_matches) else len(cleaned)
            item_text = cleaned[match.end():end].strip(" \n;,-")
            if item_text:
                items.append(item_text)
        if items:
            labels = ('Premier point', 'Deuxième point', 'Troisième point')
            spoken_parts: list[str] = []
            stripped_preface = strip_greeting_prefix(preface) if preface else ''
            if stripped_preface:
                spoken_parts.append(ensure_sentence(stripped_preface))
            for idx, item in enumerate(items[:3]):
                label = labels[idx] if idx < len(labels) else f'Point {idx + 1}'
                spoken_parts.append(f'{label} : {ensure_sentence(item)}')
            spoken_text = " ".join(part.strip() for part in spoken_parts if part.strip())
            if spoken_text:
                return trim_voice_text(spoken_text, max_chars=SPOKEN_LIST_REPLY_MAX_CHARS)

    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    sentences = [part.strip() for part in re.split(r'(?<!\d)(?<=[.!?])\s+', cleaned) if part.strip()]
    if not sentences:
        return cleaned

    first = strip_greeting_prefix(sentences[0])
    selected_parts: list[str] = []
    if first and len(first) >= SPOKEN_REPLY_MIN_CHARS:
        selected_parts.append(first)

    for sentence in sentences[1:] if selected_parts else sentences[1:] or sentences:
        if len(selected_parts) >= SPOKEN_REPLY_MAX_SENTENCES:
            break
        candidate = sentence if selected_parts else strip_greeting_prefix(sentence)
        if candidate:
            selected_parts.append(candidate)
        if sum(len(part) for part in selected_parts) >= SPOKEN_REPLY_MIN_CHARS:
            break

    selected = " ".join(selected_parts).strip() or cleaned
    return trim_voice_text(selected)


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


def _detect_fast_reply(text: str) -> tuple[str, str] | None:
    folded = _ascii_fold(text.strip())
    if not folded:
        return None
    if folded in {
        'bonjour',
        'bonjour hermes',
        'salut',
        'salut hermes',
        'coucou',
        'coucou hermes',
        'hello hermes',
    }:
        return ('greeting', 'Bonjour Ruth.')
    return None


@dataclass
class VoiceTurnMetrics:
    turn_id: str
    started_at: float = field(default_factory=time.perf_counter)
    barge_in_reason: str | None = None
    speech_started_audio_gap_ms: int | None = None
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
        self._preroll_buffer = bytearray()
        self._sample_rate = 16000
        self._channels = 1
        self._current_turn: VoiceTurnMetrics | None = None
        self._last_speaking_notice = 0.0
        self._assistant_task: asyncio.Task | None = None
        self._capture_skip_seconds_remaining = 0.0
        self._last_audio_play_end_at = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self._set_state('LISTENING_ARMED', detail='Session WebRTC prête')
        elif isinstance(frame, VADUserStartedSpeakingFrame):
            if self._speaking or self._phase in {'SPEAKING', 'COOLDOWN'}:
                await self._emit_event(
                    'speech_ignored_during_output',
                    {
                        'phase': self._phase,
                        'elapsed_ms_since_audio_play_end': self._elapsed_ms_since_audio_play_end(),
                    },
                )
            elif self._is_within_post_tts_guard_window():
                await self._emit_event(
                    'speech_ignored_post_tts_guard',
                    {
                        'phase': self._phase,
                        'elapsed_ms_since_audio_play_end': self._elapsed_ms_since_audio_play_end(),
                    },
                )
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
            self._sample_rate = frame.sample_rate
            self._channels = frame.num_channels
            if not self._capturing:
                self._remember_preroll_audio(frame.audio, frame.sample_rate, frame.num_channels)
            if self._capturing and not self._processing:
                audio_chunk = frame.audio
                if self._capture_skip_seconds_remaining > 0:
                    bytes_per_second = frame.sample_rate * frame.num_channels * 2
                    skip_bytes = min(
                        len(audio_chunk),
                        int(self._capture_skip_seconds_remaining * bytes_per_second),
                    )
                    align = max(2, frame.num_channels * 2)
                    skip_bytes -= skip_bytes % align
                    if skip_bytes > 0:
                        audio_chunk = audio_chunk[skip_bytes:]
                        self._capture_skip_seconds_remaining = max(
                            0.0,
                            self._capture_skip_seconds_remaining - (skip_bytes / bytes_per_second),
                        )
                if audio_chunk:
                    self._audio_buffer.extend(audio_chunk)
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
            speak_data, wav_bytes = await self._bridge.speak_kokoro(HOME_GREETING, speed=TTS_SPEED)
            await self._emit_event('tts_request_done', {'engine': speak_data.get('engine_used'), 'elapsed_ms': speak_data.get('elapsed_ms')})
            await self._play_tts_audio(wav_bytes)
        finally:
            self._speaking = False
            await self._set_state('COOLDOWN', detail='Anti-écho')
            await asyncio.sleep(POST_SPEAK_COOLDOWN_SECONDS)
            await self._set_state('LISTENING_AGAIN', detail='Écoute relancée')

    async def _handle_turn(self, captured_audio: bytes, sample_rate: int, channels: int, turn: VoiceTurnMetrics | None) -> None:
        try:
            captured_audio_seconds = (
                round(len(captured_audio) / (sample_rate * channels * 2), 3)
                if sample_rate and channels
                else None
            )
            if captured_audio_seconds is not None and captured_audio_seconds < MIN_CAPTURED_AUDIO_SECONDS:
                await self._emit_event(
                    'transcription_ignored',
                    {
                        'turn_id': turn.turn_id if turn else None,
                        'reason': 'captured_audio_too_short',
                        'current_state': self._phase,
                        'captured_audio_seconds': captured_audio_seconds,
                        'elapsed_ms_since_audio_play_end': self._elapsed_ms_since_audio_play_end(),
                        'provider_mode': CONFIG.hermes_engine_mode,
                    },
                )
                await self._set_state('LISTENING_AGAIN', detail='Capture trop courte, reparle.')
                return
            await self._set_state('TRANSCRIBING', detail='Transcription en cours')
            wav_bytes = pcm_to_wav_bytes(captured_audio, sample_rate, channels)
            prompt = CONFIG.speech_prompt
            if turn and turn.barge_in_reason == 'assistant_busy':
                prompt = f"{prompt} {BARGE_IN_INTERRUPT_HINT}"
            stt_data = await self._bridge.transcribe_wav(
                wav_bytes,
                language=CONFIG.speech_language,
                prompt=prompt,
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
                'stt_backend': stt_data.get('backend'),
                'captured_audio_seconds': captured_audio_seconds,
                'elapsed_ms_since_audio_play_end': self._elapsed_ms_since_audio_play_end(),
            })
            if not transcript:
                await self._set_state('LISTENING_AGAIN', detail='Aucune parole comprise')
                return
            echo_match = self._detect_barge_in_echo(
                transcript,
                turn=turn,
                duration_seconds=stt_data.get('duration_seconds'),
            )
            if echo_match:
                await self._emit_event(
                    'barge_in_echo_ignored',
                    {
                        'turn_id': turn.turn_id if turn else None,
                        'text': transcript,
                        'matched_against': echo_match,
                    },
                )
                await self._set_state('LISTENING_AGAIN', detail='Écho assistant ignoré, reparle.')
                return
            if self._should_ignore_short_post_tts_transcript(transcript, turn=turn):
                await self._emit_event(
                    'transcription_ignored',
                    {
                        'turn_id': turn.turn_id if turn else None,
                        'reason': self._transcription_ignore_reason(transcript, turn=turn),
                        'text': transcript,
                        'current_state': self._phase,
                        'confidence': confidence,
                        'duration_seconds': stt_data.get('duration_seconds'),
                        'stt_backend': stt_data.get('backend'),
                        'captured_audio_seconds': captured_audio_seconds,
                        'elapsed_ms_since_audio_play_end': self._elapsed_ms_since_audio_play_end(),
                        'provider_mode': CONFIG.hermes_engine_mode,
                    },
                )
                await self._set_state('LISTENING_AGAIN', detail='Transcription post-TTS ignorée.')
                return

            self._history.append(ChatTurn(role='user', content=transcript))
            await self._emit_event(
                'transcription_accepted',
                {
                    'turn_id': turn.turn_id if turn else None,
                    'text': transcript,
                    'current_state': self._phase,
                    'confidence': confidence,
                    'duration_seconds': stt_data.get('duration_seconds'),
                    'stt_backend': stt_data.get('backend'),
                    'captured_audio_seconds': captured_audio_seconds,
                    'elapsed_ms_since_audio_play_end': self._elapsed_ms_since_audio_play_end(),
                    'provider_mode': CONFIG.hermes_engine_mode,
                },
            )
            await self._emit_message('user', transcript, confidence=confidence)
            local_command = _detect_local_command(transcript) if CONFIG.enable_local_commands else None
            if local_command:
                await self._handle_local_command(local_command, transcript, turn)
                return
            fast_reply = _detect_fast_reply(transcript)
            if fast_reply:
                await self._handle_fast_reply(fast_reply[0], fast_reply[1], transcript, turn)
                return
            await self._set_state('THINKING', detail='Hermès réfléchit')
            hermes_data = await self._bridge.chat(
                HermesProxyRequest(
                    message=transcript,
                    history=self._history[-4:],
                    engine_mode=CONFIG.hermes_engine_mode,
                    session_id=self._session_id,
                )
            )
            reply = str(hermes_data.get('reply') or '').strip() or 'Je suis prête pour la suite.'
            spoken_reply = _compact_reply_for_voice(reply)
            if turn:
                turn.hermes_done_ms = int((time.perf_counter() - turn.started_at) * 1000)
            self._history.append(ChatTurn(role='assistant', content=reply))
            await self._emit_event('hermes_response_done', {
                'turn_id': turn.turn_id if turn else None,
                'engine': hermes_data.get('engine'),
                'provider': hermes_data.get('provider'),
                'model': hermes_data.get('model'),
                'provider_mode': CONFIG.hermes_engine_mode,
            })
            await self._emit_message('assistant', reply)
            if spoken_reply != reply:
                await self._emit_event(
                    'assistant_reply_compacted',
                    {
                        'turn_id': turn.turn_id if turn else None,
                        'display_chars': len(reply),
                        'spoken_chars': len(spoken_reply),
                        'spoken_preview': spoken_reply[:80],
                        'spoken_text': spoken_reply,
                    },
                )
            self._speaking = True
            await self._set_state('SPEAKING', detail='Hermès parle')
            speak_data, reply_wav = await self._bridge.speak_kokoro(spoken_reply, speed=TTS_SPEED)
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
            await asyncio.sleep(POST_SPEAK_COOLDOWN_SECONDS)
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
            self._capture_skip_seconds_remaining = 0.0
            self._audio_buffer.clear()
            self._assistant_task = None

    def _elapsed_ms_since_audio_play_end(self) -> int | None:
        if not self._last_audio_play_end_at:
            return None
        return int((time.perf_counter() - self._last_audio_play_end_at) * 1000)

    def _is_within_post_tts_guard_window(self) -> bool:
        elapsed_ms = self._elapsed_ms_since_audio_play_end()
        return elapsed_ms is not None and elapsed_ms < BARGE_IN_ACCEPT_AFTER_AUDIO_END_MS

    def _should_ignore_short_post_tts_transcript(
        self,
        transcript: str,
        *,
        turn: VoiceTurnMetrics | None = None,
    ) -> bool:
        elapsed_ms = turn.speech_started_audio_gap_ms if turn and turn.speech_started_audio_gap_ms is not None else self._elapsed_ms_since_audio_play_end()
        if elapsed_ms is None or elapsed_ms > BARGE_IN_TRANSCRIPT_GUARD_MS:
            return False
        if elapsed_ms < BARGE_IN_ACCEPT_AFTER_AUDIO_END_MS:
            return True

        tokens = _tokenize_command_text(transcript)
        if _detect_local_command(transcript):
            return False
        if len(transcript.strip()) <= BARGE_IN_SHORT_TRANSCRIPT_MAX_CHARS:
            return True
        if len(tokens) <= BARGE_IN_SHORT_TRANSCRIPT_MAX_TOKENS:
            return True
        return False

    def _transcription_ignore_reason(self, transcript: str, *, turn: VoiceTurnMetrics | None = None) -> str:
        elapsed_ms = turn.speech_started_audio_gap_ms if turn and turn.speech_started_audio_gap_ms is not None else self._elapsed_ms_since_audio_play_end()
        if elapsed_ms is not None and elapsed_ms < BARGE_IN_ACCEPT_AFTER_AUDIO_END_MS:
            return 'post_tts_guard_window'
        tokens = _tokenize_command_text(transcript)
        if len(transcript.strip()) <= BARGE_IN_SHORT_TRANSCRIPT_MAX_CHARS:
            return 'post_tts_short_transcript'
        if len(tokens) <= BARGE_IN_SHORT_TRANSCRIPT_MAX_TOKENS:
            return 'post_tts_short_tokens'
        return 'post_tts_filtered'

    async def cancel_assistant_task(self) -> None:
        task = self._assistant_task
        if not task or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    def _detect_barge_in_echo(
        self,
        transcript: str,
        *,
        turn: VoiceTurnMetrics | None,
        duration_seconds: Any | None,
    ) -> str | None:
        if not turn or turn.barge_in_reason != 'assistant_busy':
            return None
        try:
            duration_value = float(duration_seconds) if duration_seconds is not None else 0.0
        except (TypeError, ValueError):
            duration_value = 0.0
        if duration_value > BARGE_IN_ECHO_MAX_DURATION_SECONDS:
            return None

        folded_transcript = _ascii_fold(transcript)
        if len(folded_transcript) < 8:
            return None

        candidates: list[tuple[str, str]] = [('home_greeting', HOME_GREETING)]
        for chat_turn in reversed(self._history):
            if chat_turn.role == 'assistant' and chat_turn.content.strip():
                candidates.append(('last_assistant', chat_turn.content))
                break

        for label, candidate in candidates:
            folded_candidate = _ascii_fold(candidate)
            if not folded_candidate:
                continue
            if folded_transcript in folded_candidate or folded_candidate in folded_transcript:
                return label
            if _similarity(folded_transcript, folded_candidate) >= 0.64:
                return label
        return None

    async def _start_capture(self, *, barge_in_reason: str | None = None) -> None:
        self._capturing = True
        self._speech_seen = True
        self._audio_buffer.clear()
        if self._preroll_buffer:
            self._audio_buffer.extend(self._preroll_buffer)
        speech_started_audio_gap_ms = self._elapsed_ms_since_audio_play_end()
        self._capture_skip_seconds_remaining = (
            BARGE_IN_AUDIO_SETTLE_SECONDS if barge_in_reason == 'assistant_busy' else 0.0
        )
        self._current_turn = VoiceTurnMetrics(
            turn_id=str(uuid4()),
            barge_in_reason=barge_in_reason,
            speech_started_audio_gap_ms=speech_started_audio_gap_ms,
        )
        self._current_turn.speech_detected_ms = 0
        await self._set_state('RECORDING', detail='Ruth parle')
        await self._emit_event(
            'user_speech_detected',
            {
                'turn_id': self._current_turn.turn_id,
                'current_state': self._phase,
                'elapsed_ms_since_audio_play_end': speech_started_audio_gap_ms,
                'preroll_ms': int(CAPTURE_PREROLL_SECONDS * 1000),
            },
        )

    def _remember_preroll_audio(self, audio: bytes, sample_rate: int, channels: int) -> None:
        if not audio or sample_rate <= 0 or channels <= 0:
            return
        self._preroll_buffer.extend(audio)
        max_bytes = int(sample_rate * channels * 2 * CAPTURE_PREROLL_SECONDS)
        if max_bytes <= 0:
            self._preroll_buffer.clear()
            return
        overflow = len(self._preroll_buffer) - max_bytes
        if overflow > 0:
            del self._preroll_buffer[:overflow]

    async def _begin_barge_in(self, reason: str) -> None:
        await self._emit_event('barge_in_start', {'reason': reason, 'phase': self._phase})
        if self._interrupt_output:
            interrupted = self._interrupt_output()
            await self._emit_event('audio_output_interrupted', {'interrupted': bool(interrupted)})
        await self.cancel_assistant_task()
        self._processing = False
        self._speaking = False
        await self._start_capture(barge_in_reason=reason)

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
        speak_data, reply_wav = await self._bridge.speak_kokoro(reply, speed=TTS_SPEED)
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
        await asyncio.sleep(POST_SPEAK_COOLDOWN_SECONDS)
        await self._set_state('LISTENING_AGAIN', detail='Écoute relancée')

    async def _handle_fast_reply(
        self,
        intent: str,
        reply: str,
        transcript: str,
        turn: VoiceTurnMetrics | None,
    ) -> None:
        self._history.append(ChatTurn(role='assistant', content=reply))
        await self._emit_event(
            'fast_reply',
            {
                'turn_id': turn.turn_id if turn else None,
                'intent': intent,
                'transcript': transcript,
            },
        )
        await self._emit_message('assistant', reply)
        self._speaking = True
        await self._set_state('SPEAKING', detail='Hermès répond rapidement')
        speak_data, reply_wav = await self._bridge.speak_kokoro(reply, speed=TTS_SPEED)
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
                'intent': intent,
            },
        )
        await self._play_tts_audio(reply_wav, turn=turn)
        self._speaking = False
        await self._set_state('COOLDOWN', detail='Anti-écho')
        await asyncio.sleep(POST_SPEAK_COOLDOWN_SECONDS)
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
        self._last_audio_play_end_at = time.perf_counter()
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
                params=VADParams(confidence=0.52, start_secs=0.08, stop_secs=0.34, min_volume=0.18),
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
                logger.warning('_interrupt_audio_output: _chunk_queue not found — pipecat API may have changed, barge-in audio drain skipped')
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
