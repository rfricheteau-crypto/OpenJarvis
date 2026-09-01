from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from hermes_webrtc_poc import runtime
from hermes_webrtc_poc.config import CONFIG
from hermes_webrtc_poc.runtime import (
    TTS_SPEED,
    VAD_CONFIDENCE,
    VAD_MIN_VOLUME,
    VAD_SPEECH_START_SECONDS,
    FrameDirection,
    FrameProcessor,
    HermesVoiceProcessor,
    VoiceTurnMetrics,
    VADUserStartedSpeakingFrame,
    _compact_reply_for_voice,
    _is_interruption_only,
    _normalize_transcript,
    _split_tts_chunks,
)


class BargeInTests(unittest.TestCase):
    def test_barge_in_vad_is_tuned_for_short_spoken_interruptions(self) -> None:
        self.assertLessEqual(VAD_SPEECH_START_SECONDS, 0.04)
        self.assertLessEqual(VAD_MIN_VOLUME, 0.10)
        self.assertLessEqual(VAD_CONFIDENCE, 0.45)

    def test_stt_hint_contains_names_not_language_instructions(self) -> None:
        self.assertIn('Hermès', CONFIG.speech_prompt)
        self.assertIn('bloc', CONFIG.speech_prompt)
        self.assertNotIn('Ne pas', CONFIG.speech_prompt)

    def test_pedro_project_block_is_not_sent_to_hermes_as_a_blog(self) -> None:
        self.assertEqual(
            _normalize_transcript('Quel est le prochain blog Pedro ?'),
            'Quel est le prochain bloc Pedro?',
        )
        self.assertEqual(
            _normalize_transcript('Peux-tu écrire le blog de Pedro ?'),
            'Peux-tu écrire le blog de Pedro?',
        )

    def test_vad_while_speaking_routes_to_barge_in(self) -> None:
        processor = HermesVoiceProcessor(bridge=SimpleNamespace(), session_id="test-session")
        processor._speaking = True
        processor._phase = "SPEAKING"
        processor._begin_barge_in = AsyncMock()

        with (
            patch.object(FrameProcessor, "process_frame", new=AsyncMock()),
            patch.object(FrameProcessor, "_check_started", return_value=True),
        ):
            asyncio.run(processor.process_frame(VADUserStartedSpeakingFrame(), FrameDirection.DOWNSTREAM))

        processor._begin_barge_in.assert_awaited_once_with("assistant_busy")

    def test_barge_in_interrupts_output_and_rearms_capture(self) -> None:
        interrupted = []
        processor = HermesVoiceProcessor(
            bridge=SimpleNamespace(),
            session_id="test-session",
            interrupt_output=lambda: interrupted.append(True) or True,
        )
        processor._emit_event = AsyncMock()
        processor.cancel_assistant_task = AsyncMock()
        processor._start_capture = AsyncMock()
        processor._processing = True
        processor._speaking = True
        processor._phase = "SPEAKING"

        asyncio.run(processor._begin_barge_in("assistant_busy"))

        self.assertEqual(interrupted, [True])
        processor.cancel_assistant_task.assert_awaited_once()
        processor._start_capture.assert_awaited_once_with(barge_in_reason="assistant_busy")
        self.assertFalse(processor._processing)
        self.assertFalse(processor._speaking)
        processor._emit_event.assert_any_await("audio_output_interrupted", {"interrupted": True})
        self.assertIsNotNone(processor._last_audio_play_end_at)

    def test_voice_reply_keeps_the_written_information(self) -> None:
        written = (
            "Oui, je m'en occupe tout de suite. "
            "Je vérifie la mission Pedro et je reviens avec le résultat. "
            "Ensuite nous regarderons les détails si nécessaire."
        )
        reply = _compact_reply_for_voice(written)

        self.assertEqual(reply, written)
        self.assertLessEqual(TTS_SPEED, 1.25)

    def test_grounded_project_status_keeps_the_written_information(self) -> None:
        reply = _compact_reply_for_voice(
            "Pour Pedro OS, le bloc actif publié est WebMCP — validation depuis ChatGPT réel lorsqu'il sera disponible. "
            "Prochaine action publiée : Tester WebMCP depuis un navigateur ChatGPT compatible."
        )

        self.assertIn("WebMCP", reply)
        self.assertIn("Prochaine action publiée", reply)

    def test_tts_chunks_keep_every_word_and_start_with_a_short_clause(self) -> None:
        text = (
            "Pour Pedro OS, le bloc actif publié est WebMCP — validation depuis ChatGPT réel lorsqu'il sera disponible. "
            "Prochaine action publiée : Tester WebMCP depuis un navigateur ChatGPT compatible."
        )

        chunks = _split_tts_chunks(text)

        self.assertGreater(len(chunks), 1)
        self.assertEqual(" ".join(chunks), text)
        self.assertLessEqual(len(chunks[0]), 72)

    def test_progressive_tts_plays_all_chunks_in_order(self) -> None:
        processor = HermesVoiceProcessor(bridge=SimpleNamespace(), session_id="test-session")
        processor._bridge.speak_kokoro = AsyncMock(
            side_effect=[
                ({"engine_used": "kokoro", "elapsed_ms": 10, "speed": 1.25}, b"first"),
                ({"engine_used": "kokoro", "elapsed_ms": 10, "speed": 1.25}, b"second"),
            ]
        )
        processor._emit_event = AsyncMock()
        processor._play_tts_audio = AsyncMock()

        asyncio.run(processor._speak_reply_progressively(
            "Un premier morceau volontairement assez long pour déclencher une séparation, puis un second morceau à lire.",
            turn=None,
        ))

        self.assertEqual(processor._bridge.speak_kokoro.await_count, 2)
        self.assertEqual(processor._play_tts_audio.await_count, 2)
        self.assertEqual(processor._play_tts_audio.await_args_list[0].args[0], b"first")
        self.assertEqual(processor._play_tts_audio.await_args_list[1].args[0], b"second")
        self.assertFalse(processor._play_tts_audio.await_args_list[0].kwargs["is_final_chunk"])
        self.assertTrue(processor._play_tts_audio.await_args_list[1].kwargs["is_final_chunk"])

    def test_interruption_commands_are_not_sent_as_chat_questions(self) -> None:
        self.assertTrue(_is_interruption_only('Stop, je t’interromps.'))
        self.assertTrue(_is_interruption_only('attends'))
        self.assertFalse(_is_interruption_only('Stop, je veux te demander autre chose'))

    def test_short_capture_right_after_barge_in_is_silenced_before_stt(self) -> None:
        processor = HermesVoiceProcessor(bridge=SimpleNamespace(), session_id="test-session")
        immediate_barge = VoiceTurnMetrics(
            turn_id='turn',
            barge_in_reason='assistant_busy',
            speech_started_audio_gap_ms=0,
        )
        self.assertTrue(processor._should_silence_short_barge_capture(0.8, turn=immediate_barge))
        self.assertFalse(processor._should_silence_short_barge_capture(1.8, turn=immediate_barge))
        self.assertFalse(processor._should_silence_short_barge_capture(0.8, turn=None))

    def test_greeting_starts_listening_without_waiting_for_tts(self) -> None:
        processor = HermesVoiceProcessor(bridge=SimpleNamespace(), session_id="test-session")
        processor._emit_message = AsyncMock()
        processor._set_state = AsyncMock()

        asyncio.run(processor.greet())

        processor._emit_message.assert_awaited_once()
        processor._set_state.assert_awaited_once_with('LISTENING_AGAIN', detail='Je t’écoute.')

    def test_diagnostics_keep_latency_fields_but_redact_conversation(self) -> None:
        from tempfile import TemporaryDirectory
        from pathlib import Path

        with TemporaryDirectory() as directory, patch.object(runtime, 'VOICE_DIAGNOSTICS_PATH', Path(directory) / 'voice.jsonl'):
            runtime._write_voice_diagnostic(
                'private-session',
                'event',
                {
                    'name': 'transcription_accepted',
                    'payload': {'text': 'phrase privée', 'spoken_preview': 'réponse privée', 'elapsed_ms': 123},
                },
            )
            row = json.loads((Path(directory) / 'voice.jsonl').read_text(encoding='utf-8'))

        self.assertEqual(row['kind'], 'event')
        self.assertEqual(row['payload']['payload']['elapsed_ms'], 123)
        self.assertEqual(row['payload']['payload']['text'], {'redacted': True, 'chars': len('phrase privée')})
        self.assertEqual(row['payload']['payload']['spoken_preview'], {'redacted': True, 'chars': len('réponse privée')})
        self.assertNotIn('phrase privée', json.dumps(row, ensure_ascii=False))
        self.assertNotIn('réponse privée', json.dumps(row, ensure_ascii=False))
