"""Faster-Whisper speech-to-text backend (local, CTranslate2-based)."""

from __future__ import annotations

import tempfile
from typing import List, Optional

from openjarvis.core.registry import SpeechRegistry
from openjarvis.speech._stubs import Segment, SpeechBackend, TranscriptionResult

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None  # type: ignore[assignment, misc]


@SpeechRegistry.register("faster-whisper")
class FasterWhisperBackend(SpeechBackend):
    """Local speech-to-text using Faster-Whisper (CTranslate2)."""

    backend_id = "faster-whisper"

    def __init__(
        self,
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "float16",
    ) -> None:
        self._model_size = model_size
        self._device = device
        self._compute_type = compute_type
        self._model: Optional[WhisperModel] = None
        self._effective_compute_type: Optional[str] = None
        self._last_error: Optional[str] = None

    @property
    def effective_compute_type(self) -> Optional[str]:
        return self._effective_compute_type

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    def _candidate_compute_types(self) -> List[str]:
        preferred = (self._compute_type or "float16").strip().lower()
        candidates: List[str] = []
        for candidate in (preferred, "int8", "float32"):
            if candidate and candidate not in candidates:
                candidates.append(candidate)
        return candidates

    def _ensure_model(self) -> WhisperModel:
        """Lazy-load the Whisper model on first use."""
        if self._model is None:
            if WhisperModel is None:
                raise ImportError(
                    "faster-whisper is not installed. "
                    "Install with: uv sync --extra speech"
                )
            errors: List[str] = []
            for candidate in self._candidate_compute_types():
                try:
                    self._model = WhisperModel(
                        self._model_size,
                        device=self._device,
                        compute_type=candidate,
                    )
                    self._effective_compute_type = candidate
                    self._last_error = None
                    break
                except Exception as exc:
                    self._model = None
                    errors.append(f"{candidate}: {exc}")

            if self._model is None:
                self._last_error = "; ".join(errors)[-900:]
                raise RuntimeError(
                    "Failed to initialize faster-whisper model"
                    f" (candidates: {', '.join(self._candidate_compute_types())})"
                )
        return self._model

    def transcribe(
        self,
        audio: bytes,
        *,
        format: str = "wav",
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> TranscriptionResult:
        """Transcribe audio bytes using Faster-Whisper."""
        model = self._ensure_model()

        # Write audio to a temp file (faster-whisper needs a file path)
        suffix = f".{format}" if not format.startswith(".") else format
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
            tmp.write(audio)
            tmp.flush()

            kwargs = {}
            if language:
                kwargs["language"] = language
            if prompt:
                kwargs["initial_prompt"] = prompt

            segments_iter, info = model.transcribe(tmp.name, **kwargs)
            segments_list = list(segments_iter)

        # Build result
        text = "".join(seg.text for seg in segments_list).strip()
        self._last_error = None
        segments = [
            Segment(
                text=seg.text.strip(),
                start=seg.start,
                end=seg.end,
                confidence=None,
            )
            for seg in segments_list
        ]

        return TranscriptionResult(
            text=text,
            language=getattr(info, "language", None),
            confidence=getattr(info, "language_probability", None),
            duration_seconds=getattr(info, "duration", 0.0),
            segments=segments,
        )

    def health(self) -> bool:
        """Check if model is loaded or loadable."""
        if WhisperModel is None:
            self._last_error = "faster-whisper import failed"
            return False
        if self._model is not None:
            return True
        try:
            self._ensure_model()
            return True
        except Exception as exc:
            self._last_error = str(exc)
            return False

    def supported_formats(self) -> List[str]:
        """Supported audio formats (same as ffmpeg/Whisper)."""
        return ["wav", "mp3", "m4a", "ogg", "flac", "webm"]
