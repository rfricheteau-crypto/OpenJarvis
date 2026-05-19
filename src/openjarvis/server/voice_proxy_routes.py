"""Voice TTS proxy routes (Phase 1C).

This router keeps OpenJarvis backend stable and forwards synthesis requests to
an isolated local sidecar service.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/voice", tags=["voice"])

_VOICE_RUNTIME_ROOT = Path.home() / ".openjarvis" / "jarvis-personal" / "runtime" / "voice"
_VOICE_OUTPUT_DIR = _VOICE_RUNTIME_ROOT / "tts_out"
_VOICE_EVENTS_LOG = _VOICE_RUNTIME_ROOT / "voice_speak_events.jsonl"

_SIDECAR_URL = os.environ.get("OPENJARVIS_VOICE_SIDECAR_URL", "http://127.0.0.1:8011").rstrip("/")
_SIDECAR_TIMEOUT_SECONDS = float(os.environ.get("OPENJARVIS_VOICE_SIDECAR_TIMEOUT", "45"))
_AUDIO_MAX_AGE_SECONDS = int(os.environ.get("OPENJARVIS_VOICE_AUDIO_MAX_AGE", "7200"))
_AUDIO_KEEP_LATEST = int(os.environ.get("OPENJARVIS_VOICE_AUDIO_KEEP", "64"))
_HEALTH_TIMEOUT_SECONDS = float(os.environ.get("OPENJARVIS_VOICE_HEALTH_TIMEOUT", "3"))

_AUDIO_FILE_RE = re.compile(r"^[A-Za-z0-9_.-]+\.wav$")
_ENGINE_LITERAL_VALUES = {"kokoro", "piper", "espeak", "browser"}

_LAST_ENGINE_USED: str | None = None
_LAST_ERROR: str | None = None


class VoiceSpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    engine: Literal["kokoro", "piper", "espeak"] = "kokoro"
    speed: float = Field(default=1.0, ge=0.85, le=1.25)


class VoiceSpeakResponse(BaseModel):
    ok: bool
    request_id: str
    engine_requested: str
    engine_used: str
    audio_file: str
    audio_url: str
    elapsed_ms: int
    speed: float = 1.0
    warnings: list[str] = Field(default_factory=list)


class VoiceHealthResponse(BaseModel):
    sidecar_available: bool
    preferred_engine: Literal["kokoro"] = "kokoro"
    fallback_available: bool
    last_engine_used: Literal["kokoro", "piper", "espeak", "browser"] | None = None
    last_error: str | None = None
    status: Literal["ready", "degraded", "unavailable"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_event(payload: dict) -> None:
    _VOICE_EVENTS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _VOICE_EVENTS_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _validate_audio_file(audio_file: str) -> str:
    if not _AUDIO_FILE_RE.fullmatch(audio_file):
        raise HTTPException(status_code=400, detail="Invalid audio file name")
    return audio_file


def _set_last_error(message: str | None) -> None:
    global _LAST_ERROR
    _LAST_ERROR = message


def _set_last_engine(engine_name: str | None) -> None:
    global _LAST_ENGINE_USED
    if engine_name and engine_name in _ENGINE_LITERAL_VALUES:
        _LAST_ENGINE_USED = engine_name


def _hydrate_runtime_state() -> tuple[str | None, str | None]:
    if not _VOICE_EVENTS_LOG.exists():
        return None, None

    last_engine: str | None = None
    last_error: str | None = None
    error_seen = False
    try:
        lines = _VOICE_EVENTS_LOG.read_text(encoding="utf-8").splitlines()
        for line in reversed(lines[-200:]):
            try:
                payload = json.loads(line)
            except Exception:
                continue

            if last_engine is None:
                candidate = payload.get("engine_used")
                if isinstance(candidate, str) and candidate in _ENGINE_LITERAL_VALUES:
                    last_engine = candidate

            if not error_seen:
                if "last_error" in payload:
                    error_seen = True
                    candidate = payload.get("last_error")
                    if isinstance(candidate, str) and candidate.strip():
                        last_error = candidate.strip()
                    else:
                        last_error = None
                else:
                    for key in ("error", "detail"):
                        candidate = payload.get(key)
                        if isinstance(candidate, str) and candidate.strip():
                            last_error = candidate.strip()
                            error_seen = True
                            break

            if last_engine is not None and error_seen:
                break
    except Exception:
        return None, None

    return last_engine, last_error


def _cleanup_old_audio_files() -> None:
    _VOICE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    wav_files = [p for p in _VOICE_OUTPUT_DIR.glob("*.wav") if p.is_file()]
    wav_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    for idx, path in enumerate(wav_files):
        age = now - path.stat().st_mtime
        if idx >= _AUDIO_KEEP_LATEST or age > _AUDIO_MAX_AGE_SECONDS:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass


@router.post("/speak", response_model=VoiceSpeakResponse)
async def speak(payload: VoiceSpeakRequest):
    request_id = str(uuid4())
    started = time.perf_counter()

    sidecar_payload = {
        "request_id": request_id,
        "text": payload.text.strip(),
        "engine": payload.engine,
        "speed": payload.speed,
    }

    try:
        async with httpx.AsyncClient(timeout=_SIDECAR_TIMEOUT_SECONDS) as client:
            response = await client.post(f"{_SIDECAR_URL}/speak", json=sidecar_payload)
    except httpx.TimeoutException as exc:
        message = (
            "Voice sidecar timeout. Start the warm sidecar first "
            "(scripts/start_kokoro_warm_sidecar.sh)."
        )
        _set_last_error(message)
        _append_event(
            {
                "ts": _now_iso(),
                "request_id": request_id,
                "route": "/api/voice/speak",
                "engine_requested": payload.engine,
                "engine_used": None,
                "speed": payload.speed,
                "elapsed_ms": int((time.perf_counter() - started) * 1000),
                "error": "timeout",
                "detail": message,
            }
        )
        raise HTTPException(
            status_code=504,
            detail=message,
        ) from exc
    except Exception as exc:
        message = "Voice sidecar unavailable. Start it with scripts/start_kokoro_warm_sidecar.sh."
        _set_last_error(message)
        _append_event(
            {
                "ts": _now_iso(),
                "request_id": request_id,
                "route": "/api/voice/speak",
                "engine_requested": payload.engine,
                "engine_used": None,
                "speed": payload.speed,
                "elapsed_ms": int((time.perf_counter() - started) * 1000),
                "error": "sidecar_unavailable",
                "detail": message,
            }
        )
        raise HTTPException(
            status_code=503,
            detail=message,
        ) from exc

    if response.status_code >= 400:
        detail = response.text
        try:
            parsed = response.json()
            detail = parsed.get("detail") or parsed
        except Exception:
            pass
        detail_str = f"Voice sidecar error: {detail}"
        _set_last_error(detail_str)
        _append_event(
            {
                "ts": _now_iso(),
                "request_id": request_id,
                "route": "/api/voice/speak",
                "engine_requested": payload.engine,
                "engine_used": None,
                "speed": payload.speed,
                "elapsed_ms": int((time.perf_counter() - started) * 1000),
                "error": "sidecar_error",
                "detail": detail_str,
            }
        )
        raise HTTPException(status_code=502, detail=f"Voice sidecar error: {detail}")

    data = response.json()
    audio_file = _validate_audio_file(str(data.get("audio_file", "")))
    audio_path = _VOICE_OUTPUT_DIR / audio_file
    if not audio_path.exists():
        _set_last_error("Voice sidecar returned missing audio file")
        raise HTTPException(status_code=502, detail="Voice sidecar returned missing audio file")

    _cleanup_old_audio_files()

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    engine_used = str(data.get("engine_used") or "unknown")
    if engine_used in _ENGINE_LITERAL_VALUES:
        _set_last_engine(engine_used)
    _set_last_error(None)
    warnings = [str(item) for item in (data.get("warnings") or [])]

    _append_event(
        {
            "ts": _now_iso(),
            "request_id": request_id,
            "route": "/api/voice/speak",
            "engine_requested": payload.engine,
            "engine_used": engine_used,
            "speed": float(data.get("speed") or payload.speed),
            "audio_file": audio_file,
            "elapsed_ms": elapsed_ms,
            "sidecar_elapsed_ms": int(data.get("elapsed_ms") or 0),
            "warnings": warnings,
            "last_error": None,
        }
    )

    return VoiceSpeakResponse(
        ok=True,
        request_id=request_id,
        engine_requested=payload.engine,
        engine_used=engine_used,
        audio_file=audio_file,
        audio_url=f"/api/voice/audio/{audio_file}",
        elapsed_ms=elapsed_ms,
        speed=float(data.get("speed") or payload.speed),
        warnings=warnings,
    )


@router.get("/audio/{audio_file}")
async def get_audio(audio_file: str):
    safe_name = _validate_audio_file(audio_file)
    audio_path = _VOICE_OUTPUT_DIR / safe_name
    if not audio_path.exists() or not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(audio_path, media_type="audio/wav", filename=safe_name)


@router.get("/health")
async def health():
    global _LAST_ENGINE_USED, _LAST_ERROR

    hydrated_engine, hydrated_error = _hydrate_runtime_state()
    if hydrated_engine is not None:
        _LAST_ENGINE_USED = hydrated_engine
    elif _LAST_ENGINE_USED is None:
        _LAST_ENGINE_USED = hydrated_engine

    # Use latest persisted state when available so multi-process workers stay consistent.
    if hydrated_error is not None or (hydrated_error is None and _VOICE_EVENTS_LOG.exists()):
        _LAST_ERROR = hydrated_error

    sidecar_ok = False
    sidecar_payload: dict[str, object] = {}
    sidecar_error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT_SECONDS) as client:
            response = await client.get(f"{_SIDECAR_URL}/health")
            if response.status_code == 200:
                sidecar_ok = True
                try:
                    sidecar_payload = response.json()
                except Exception:
                    sidecar_payload = {"raw": response.text}
            else:
                sidecar_error = f"Sidecar health status {response.status_code}"
    except Exception:
        sidecar_ok = False
        sidecar_error = "Sidecar non démarré ou injoignable"

    kokoro_ready = bool(sidecar_payload.get("kokoro_preloaded")) if sidecar_ok else False
    piper_loaded = bool(sidecar_payload.get("piper_loaded")) if sidecar_ok else False
    startup_errors = sidecar_payload.get("startup_errors")
    has_startup_errors = isinstance(startup_errors, list) and len(startup_errors) > 0

    # Local fallback is available only when sidecar is reachable (piper/espeak live there).
    fallback_available = bool(sidecar_ok)

    if sidecar_ok and kokoro_ready:
        status: Literal["ready", "degraded", "unavailable"] = "ready"
    elif sidecar_ok and (piper_loaded or fallback_available):
        status = "degraded"
    else:
        status = "unavailable"

    last_error = _LAST_ERROR
    if sidecar_ok and kokoro_ready and not has_startup_errors:
        last_error = None
        _LAST_ERROR = None
    if sidecar_error and not last_error:
        last_error = sidecar_error
    if has_startup_errors and not kokoro_ready:
        last_error = "; ".join(str(item) for item in startup_errors)

    return VoiceHealthResponse(
        sidecar_available=sidecar_ok,
        preferred_engine="kokoro",
        fallback_available=fallback_available,
        last_engine_used=_LAST_ENGINE_USED if _LAST_ENGINE_USED in _ENGINE_LITERAL_VALUES else None,
        last_error=last_error,
        status=status,
    )
