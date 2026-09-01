from __future__ import annotations

import os
from dataclasses import dataclass


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _allowed_origins() -> tuple[str, ...]:
    """Keep the experimental WebRTC runtime local by default.

    G is served separately in development, so it needs explicit local origins
    to make the SDP offer.  A caller may add a trusted origin through one
    comma-separated environment variable; wildcard origins are deliberately
    unsupported.
    """
    defaults = {
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    }
    extras = {
        origin.strip().rstrip("/")
        for origin in os.environ.get("HERMES_PROTO_ALLOWED_ORIGINS", "").split(",")
        if origin.strip().startswith(("http://", "https://")) and origin.strip() != "*"
    }
    return tuple(sorted(defaults | extras))


@dataclass(frozen=True)
class ProtoConfig:
    host: str = os.environ.get("HERMES_PROTO_HOST", "127.0.0.1")
    port: int = int(os.environ.get("HERMES_PROTO_PORT", "8790"))
    hermes_base_url: str = os.environ.get("HERMES_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    hermes_chat_path: str = os.environ.get("HERMES_CHAT_PATH", "/api/hermes/chat")
    jarvis_frontend_url: str = os.environ.get(
        "HERMES_PROTO_JARVIS_FRONTEND_URL",
        "http://127.0.0.1:5173/jarvis-personal",
    ).rstrip("/")
    hermes_engine_mode: str = os.environ.get("HERMES_ENGINE_MODE", "economy")
    enable_local_commands: bool = _env_flag("HERMES_PROTO_ENABLE_LOCAL_COMMANDS", False)
    request_timeout_seconds: float = float(os.environ.get("HERMES_PROTO_TIMEOUT", "45"))
    speech_language: str = os.environ.get("HERMES_PROTO_SPEECH_LANGUAGE", "fr")
    speech_prompt: str = os.environ.get(
        "HERMES_PROTO_SPEECH_PROMPT",
        # Whisper uses this as an *initial transcript*, not as instructions.
        # A long imperative prompt can leak into short, ambiguous utterances.
        # Keep only proper names which genuinely improve recognition.
        "Hermès, Jarvis, Ruth, Ruth OS, Obsidian, Graphify, Pedro, EduPilot, bloc, blocs, projet, tâche.",
    )
    allowed_origins: tuple[str, ...] = _allowed_origins()

    @property
    def hermes_chat_url(self) -> str:
        return f"{self.hermes_base_url}{self.hermes_chat_path}"


CONFIG = ProtoConfig()
