"""Warm local TTS sidecar for Jarvis/Hermès Phase 1C.

Primary: Kokoro (ff_siwis)
Fallback: Piper (fr_FR-siwis-medium)
Emergency: eSpeak NG
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import time
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from kokoro import KPipeline
from piper.voice import PiperVoice


@dataclass
class SidecarConfig:
    runtime_voice_root: Path
    output_dir: Path
    events_log_path: Path
    piper_model_path: Path
    piper_config_path: Path
    kokoro_voice: str
    espeak_voice: str
    cleanup_max_age_seconds: int
    cleanup_keep_latest: int
    kokoro_timeout_seconds: float
    piper_timeout_seconds: float
    espeak_timeout_seconds: float


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    engine: Literal["kokoro", "piper", "espeak"] = "kokoro"
    request_id: str | None = None
    speed: float = Field(default=1.0, ge=0.85, le=1.25)


class SidecarState:
    def __init__(self, cfg: SidecarConfig):
        self.cfg = cfg
        self.kokoro_pipeline: KPipeline | None = None
        self.piper_voice: PiperVoice | None = None
        self.startup_errors: list[str] = []
        self.lock = asyncio.Lock()

    def _append_event(self, payload: dict) -> None:
        self.cfg.events_log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.cfg.events_log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def _cleanup_audio_files(self) -> None:
        self.cfg.output_dir.mkdir(parents=True, exist_ok=True)
        files = [p for p in self.cfg.output_dir.glob("*.wav") if p.is_file()]
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        now = time.time()

        for idx, path in enumerate(files):
            age = now - path.stat().st_mtime
            if idx >= self.cfg.cleanup_keep_latest or age > self.cfg.cleanup_max_age_seconds:
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass

    def _load_kokoro(self) -> None:
        if self.kokoro_pipeline is None:
            self.kokoro_pipeline = KPipeline(lang_code="f")

    def _load_piper(self) -> None:
        if self.piper_voice is None:
            if not self.cfg.piper_model_path.exists() or not self.cfg.piper_config_path.exists():
                raise RuntimeError(
                    f"Piper model missing: {self.cfg.piper_model_path} / {self.cfg.piper_config_path}"
                )
            self.piper_voice = PiperVoice.load(
                self.cfg.piper_model_path,
                config_path=self.cfg.piper_config_path,
            )

    @staticmethod
    def _write_wav_int16(out_path: Path, audio_int16: np.ndarray, sample_rate: int) -> None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        pcm = np.asarray(audio_int16, dtype=np.int16)
        with wave.open(str(out_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm.tobytes())

    @staticmethod
    def _write_wav_float32(out_path: Path, audio_float32: np.ndarray, sample_rate: int) -> None:
        clipped = np.clip(np.asarray(audio_float32, dtype=np.float32), -1.0, 1.0)
        pcm_int16 = (clipped * 32767.0).astype(np.int16)
        SidecarState._write_wav_int16(out_path, pcm_int16, sample_rate)

    def _synthesize_kokoro(self, text: str, out_path: Path, speed: float) -> None:
        self._load_kokoro()
        assert self.kokoro_pipeline is not None
        chunks: list[np.ndarray] = []
        for _graphemes, _phonemes, audio in self.kokoro_pipeline(
            text,
            voice=self.cfg.kokoro_voice,
            speed=speed,
        ):
            chunks.append(np.asarray(audio, dtype=np.float32))
        if not chunks:
            raise RuntimeError("Kokoro produced no audio chunks")
        wav = np.concatenate(chunks)
        self._write_wav_float32(out_path, wav, sample_rate=24000)

    def _synthesize_piper(self, text: str, out_path: Path) -> None:
        self._load_piper()
        assert self.piper_voice is not None
        chunk_bytes: list[bytes] = []
        sample_rate = None
        for chunk in self.piper_voice.synthesize(text):
            sample_rate = chunk.sample_rate
            chunk_bytes.append(chunk.audio_int16_bytes)
        if not chunk_bytes or sample_rate is None:
            raise RuntimeError("Piper produced no audio")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(out_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(int(sample_rate))
            wav_file.writeframes(b"".join(chunk_bytes))

    def _synthesize_espeak(self, text: str, out_path: Path) -> None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "espeak-ng",
                "-v",
                self.cfg.espeak_voice,
                "-s",
                "165",
                "-w",
                str(out_path),
                text,
            ],
            check=True,
            timeout=self.cfg.espeak_timeout_seconds,
        )

    async def _try_with_timeout(self, fn, timeout_seconds: float, *args):
        return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=timeout_seconds)

    async def speak(self, request: SpeakRequest) -> dict:
        request_id = request.request_id or str(uuid4())
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text is empty")

        started = time.perf_counter()
        self._cleanup_audio_files()

        warnings: list[str] = []
        run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{request_id[:8]}"
        out_file = f"voice_{run_id}.wav"
        out_path = self.cfg.output_dir / out_file

        if request.engine == "kokoro":
            chain: list[tuple[str, callable, float]] = [
                ("kokoro", self._synthesize_kokoro, self.cfg.kokoro_timeout_seconds),
                ("piper", self._synthesize_piper, self.cfg.piper_timeout_seconds),
                ("espeak", self._synthesize_espeak, self.cfg.espeak_timeout_seconds),
            ]
        elif request.engine == "piper":
            chain = [
                ("piper", self._synthesize_piper, self.cfg.piper_timeout_seconds),
                ("espeak", self._synthesize_espeak, self.cfg.espeak_timeout_seconds),
            ]
        else:
            chain = [("espeak", self._synthesize_espeak, self.cfg.espeak_timeout_seconds)]

        engine_used = None
        errors: list[str] = []

        async with self.lock:
            for engine_name, synth_fn, timeout_seconds in chain:
                try:
                    if engine_name == "kokoro":
                        await self._try_with_timeout(synth_fn, timeout_seconds, text, out_path, request.speed)
                    else:
                        await self._try_with_timeout(synth_fn, timeout_seconds, text, out_path)
                    if out_path.exists() and out_path.stat().st_size > 0:
                        engine_used = engine_name
                        break
                    raise RuntimeError("Audio output missing after synthesis")
                except asyncio.TimeoutError:
                    msg = f"{engine_name} timeout after {timeout_seconds:.1f}s"
                    errors.append(msg)
                    warnings.append(msg)
                except Exception as exc:
                    msg = f"{engine_name} failed: {exc}"
                    errors.append(msg)
                    warnings.append(msg)

        if engine_used is None:
            self._append_event(
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "request_id": request_id,
                "engine_requested": request.engine,
                "engine_used": None,
                "speed": request.speed,
                "ok": False,
                "errors": errors,
            }
            )
            raise HTTPException(status_code=500, detail={"message": "All local TTS engines failed", "errors": errors})

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        self._append_event(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "request_id": request_id,
                "engine_requested": request.engine,
                "engine_used": engine_used,
                "speed": request.speed,
                "ok": True,
                "audio_file": out_file,
                "elapsed_ms": elapsed_ms,
                "warnings": warnings,
            }
        )

        return {
            "ok": True,
            "request_id": request_id,
            "engine_requested": request.engine,
            "engine_used": engine_used,
            "audio_file": out_file,
            "elapsed_ms": elapsed_ms,
            "speed": request.speed,
            "warnings": warnings,
        }


def _build_config() -> SidecarConfig:
    prototype_root = Path(__file__).resolve().parents[1]
    default_model = prototype_root / "assets" / "piper" / "fr" / "fr_FR" / "siwis" / "medium" / "fr_FR-siwis-medium.onnx"
    default_cfg = default_model.with_suffix(".onnx.json")

    runtime_voice_root = Path.home() / ".openjarvis" / "jarvis-personal" / "runtime" / "voice"
    output_dir = runtime_voice_root / "tts_out"

    return SidecarConfig(
        runtime_voice_root=runtime_voice_root,
        output_dir=output_dir,
        events_log_path=runtime_voice_root / "voice_sidecar_events.jsonl",
        piper_model_path=Path(os.environ.get("OPENJARVIS_PIPER_MODEL", str(default_model))),
        piper_config_path=Path(os.environ.get("OPENJARVIS_PIPER_CONFIG", str(default_cfg))),
        kokoro_voice=os.environ.get("OPENJARVIS_KOKORO_VOICE", "ff_siwis"),
        espeak_voice=os.environ.get("OPENJARVIS_ESPEAK_VOICE", "fr-fr"),
        cleanup_max_age_seconds=int(os.environ.get("OPENJARVIS_VOICE_AUDIO_MAX_AGE", "7200")),
        cleanup_keep_latest=int(os.environ.get("OPENJARVIS_VOICE_AUDIO_KEEP", "64")),
        kokoro_timeout_seconds=float(os.environ.get("OPENJARVIS_KOKORO_TIMEOUT", "30")),
        piper_timeout_seconds=float(os.environ.get("OPENJARVIS_PIPER_TIMEOUT", "12")),
        espeak_timeout_seconds=float(os.environ.get("OPENJARVIS_ESPEAK_TIMEOUT", "6")),
    )


def create_voice_sidecar_app() -> FastAPI:
    cfg = _build_config()
    state = SidecarState(cfg)

    app = FastAPI(title="OpenJarvis Voice Sidecar", version="0.1.0")
    app.state.voice_sidecar = state

    @app.on_event("startup")
    async def _startup() -> None:
        cfg.output_dir.mkdir(parents=True, exist_ok=True)
        try:
            await asyncio.to_thread(state._load_kokoro)
        except Exception as exc:
            state.startup_errors.append(f"kokoro preload failed: {exc}")

    @app.get("/health")
    async def health() -> dict:
        return {
            "ok": True,
            "kokoro_preloaded": state.kokoro_pipeline is not None,
            "piper_loaded": state.piper_voice is not None,
            "kokoro_voice": cfg.kokoro_voice,
            "output_dir": str(cfg.output_dir),
            "startup_errors": state.startup_errors,
        }

    @app.post("/speak")
    async def speak(request: SpeakRequest) -> dict:
        return await state.speak(request)

    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "voice_sidecar_app:create_voice_sidecar_app",
        factory=True,
        host="127.0.0.1",
        port=8011,
    )
