"""Development ASGI app factory for ``uvicorn --reload``.

This module intentionally keeps ``jarvis serve`` unchanged. It provides a
factory target that uvicorn can import again after backend file changes.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from openjarvis.core.config import load_config
from openjarvis.core.events import EventBus
from openjarvis.engine import discover_engines, discover_models, get_engine
from openjarvis.intelligence import (
    merge_discovered_models,
    register_builtin_models,
)
from openjarvis.security import setup_security
from openjarvis.server.app import create_app

logger = logging.getLogger(__name__)

_CLOUD_ENV_FILE = Path.home() / ".openjarvis" / "cloud-keys.env"


def _load_cloud_keys_for_dev() -> None:
    """Load Ruth's local cloud key file without printing secret values."""
    if not _CLOUD_ENV_FILE.exists():
        return
    try:
        for raw in _CLOUD_ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and value.strip() and key not in os.environ:
                os.environ[key] = value.strip()
    except Exception as exc:
        logger.debug("Dev cloud key load skipped: %s", exc)


def _wrap_cloud_engine_if_configured(engine_name: str, engine):
    has_cloud_key = any(
        os.environ.get(name)
        for name in (
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "OPENROUTER_API_KEY",
        )
    )
    if not has_cloud_key or engine_name == "cloud":
        return engine_name, engine
    try:
        from openjarvis.engine.cloud import CloudEngine
        from openjarvis.engine.multi import MultiEngine

        cloud = CloudEngine()
        return "multi", MultiEngine([(engine_name, engine), ("cloud", cloud)])
    except Exception as exc:
        logger.debug("Dev cloud engine init skipped: %s", exc)
        return engine_name, engine


def create_dev_app():
    """Build the OpenJarvis FastAPI app for local auto-reload development.

    Unlike ``jarvis serve``, this dev factory does not start channel bridges or
    schedulers on every reload. It is meant for backend/API iteration.
    """
    _load_cloud_keys_for_dev()
    config = load_config()
    register_builtin_models()
    bus = EventBus(record_history=False)

    engine_override = os.environ.get("OPENJARVIS_DEV_ENGINE", "").strip() or None
    resolved = get_engine(config, engine_override)
    if resolved is None:
        raise RuntimeError("No inference engine available for dev server.")
    engine_name, engine = resolved
    engine_name, engine = _wrap_cloud_engine_if_configured(engine_name, engine)

    sec = setup_security(config, engine, bus)
    engine = sec.engine

    all_engines = discover_engines(config)
    all_models = discover_models(all_engines)
    for engine_key, model_ids in all_models.items():
        merge_discovered_models(engine_key, model_ids)

    model_name = (
        os.environ.get("OPENJARVIS_DEV_MODEL", "").strip()
        or config.server.model
        or config.intelligence.default_model
    )
    if not model_name:
        engine_models = all_models.get(engine_name, [])
        model_name = engine_models[0] if engine_models else "dev-model"

    return create_app(
        engine,
        model_name,
        bus=bus,
        engine_name=engine_name,
        agent_name=config.server.agent or "",
        config=config,
        cors_origins=config.server.cors_origins,
    )
