"""Personal Jarvis cockpit routes backed by jarvis-personal runtime files."""

import asyncio
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
import httpx
from pydantic import BaseModel, Field

try:
    import tomllib
except ImportError:  # pragma: no cover
    tomllib = None

router = APIRouter(prefix="/v1/personal-cockpit", tags=["personal-cockpit"])
hermes_chat_router = APIRouter(prefix="/api/hermes", tags=["hermes-chat"])
logger = logging.getLogger("openjarvis.server.personal_cockpit")
_HERMES_OBSERVER_TASKS: set[asyncio.Task[None]] = set()
_HERMES_EXECUTION_TASKS: set[asyncio.Task[None]] = set()

PERSONAL_ROOT = Path.home() / ".openjarvis" / "jarvis-personal"
VOICE_DIR = PERSONAL_ROOT / "runtime" / "voice"
WORKING_DIR = PERSONAL_ROOT / "memory" / "working"
INTEGRATIONS_DIR = PERSONAL_ROOT / "integrations"
HERMES_DIR = PERSONAL_ROOT / "runtime" / "hermes"
RUTH_OS_BRIDGE_DIR = Path.home() / "CODEX_RUTH_OS" / "CORE" / "bridge"
PROJECT_STATE_SNAPSHOTS_DIR = Path.home() / "CODEX_RUTH_OS" / "CORE" / "project-state" / "snapshots"
_PROJECT_STATE_REQUIRED_FIELDS = frozenset({"schema_version", "project", "freshness", "state"})

STATE_PATH = VOICE_DIR / "v4_state.json"
SESSIONS_PATH = VOICE_DIR / "v4_sessions.jsonl"
ACTIONS_PATH = VOICE_DIR / "v4_action_queue.jsonl"
LIVE_BRIEF_PATH = VOICE_DIR / "voice_live_brief_latest.json"
TARGETED_MOVE_PATH = VOICE_DIR / "yahoo_voice_targeted_move_latest.json"
DYNAMIC_CANDIDATE_PATH = VOICE_DIR / "yahoo_voice_dynamic_move_candidate_latest.json"
DYNAMIC_RESULT_PATH = VOICE_DIR / "yahoo_voice_dynamic_move_latest.json"
HANDOFFS_PATH = WORKING_DIR / "session_handoffs.md"
VOICE_CONFIG_PATH = INTEGRATIONS_DIR / "voice.toml"
HERMES_CORE_STATE_PATH = HERMES_DIR / "core_state.json"
HERMES_OBSERVABILITY_PATH = HERMES_DIR / "observability_report.json"
HERMES_NEXT_ACTIONS_PATH = HERMES_DIR / "next_actions.json"
HERMES_RISK_GUARD_PATH = HERMES_DIR / "risk_guard_latest.json"
HERMES_SESSION_CLOSER_PATH = HERMES_DIR / "session_closer_latest.json"
HERMES_PROJECT_ROUTE_PATH = HERMES_DIR / "project_route_latest.json"
HERMES_CURRENT_REQUEST_PATH = HERMES_DIR / "current_request.json"
HERMES_CURRENT_PACKET_PATH = HERMES_DIR / "current_packet.json"
HERMES_CURRENT_TOOL_DECISION_PATH = HERMES_DIR / "current_tool_decision.json"
HERMES_CURRENT_DELEGATION_PATH = HERMES_DIR / "current_delegation.json"
HERMES_CURRENT_TOOL_RESEARCH_PATH = HERMES_DIR / "current_tool_research.json"
HERMES_CURRENT_CODEX_HANDOFF_PATH = HERMES_DIR / "current_codex_handoff.json"
HERMES_RECENT_TRACE_JSON_PATH = HERMES_DIR / "recent_trace.json"
HERMES_RECENT_TRACE_JSONL_PATH = HERMES_DIR / "recent_trace.jsonl"
HERMES_OPENAI_USAGE_LOG_PATH = HERMES_DIR / "openai_usage_log.jsonl"
HERMES_OPENAI_BUDGET_STATE_PATH = HERMES_DIR / "openai_budget_state.json"
HERMES_PENDING_VALIDATIONS_PATH = HERMES_DIR / "pending_validations.json"
HERMES_VALIDATION_STATE_PATH = HERMES_DIR / "validation_state.json"
HERMES_EXECUTION_STATUS_PATH = HERMES_DIR / "current_execution.json"
HERMES_ALERT_ACTIONS_LOG_PATH = HERMES_DIR / "alert_actions.jsonl"
HERMES_CODEX_HANDOFF_EVENTS_LOG_PATH = HERMES_DIR / "codex_handoff_events.jsonl"
HERMES_OBSIDIAN_ACTION_INBOX_PATH = HERMES_DIR / "obsidian_action_inbox.json"
OBSIDIAN_ROOT = Path.home() / "Library" / "Mobile Documents" / "iCloud~md~obsidian" / "Documents" / "Organisation Ruth"
OBSIDIAN_IDEAS_PATH = OBSIDIAN_ROOT / "_autres-projets" / "ideas-inbox.md"
OBSIDIAN_MANIFEST_PATH = OBSIDIAN_ROOT / "00-MANIFEST.md"
OBSIDIAN_URGENCES_PATH = OBSIDIAN_ROOT / "00-URGENCES.md"
OBSIDIAN_JARVIS_STATE_PATH = OBSIDIAN_ROOT / "JARVIS" / "_etat-actuel.md"
OBSIDIAN_ADV_INBOX_PATH = OBSIDIAN_ROOT / "ADV" / "Idées" / "_inbox.md"
OBSIDIAN_ACTION_SOURCE_PATHS: tuple[tuple[str, Path, str], ...] = (
    ("Urgences", OBSIDIAN_URGENCES_PATH, "Global"),
    ("Manifeste", OBSIDIAN_MANIFEST_PATH, "Global"),
    ("ADV inbox", OBSIDIAN_ADV_INBOX_PATH, "ADV"),
    ("Jarvis état actuel", OBSIDIAN_JARVIS_STATE_PATH, "Jarvis"),
    ("Autres projets inbox", OBSIDIAN_IDEAS_PATH, "Autres projets"),
)
ADV_SNAPSHOT_PATH = PERSONAL_ROOT / "runtime" / "adv_snapshot.json"
ADV_SNAPSHOT_TTL = 300

_TAG_TO_SECTION: dict[str, str] = {
    "Business": "Idées business / service",
    "TikTok": "Idées contenu / TikTok / marketing",
    "Perso": "Idées perso / organisation",
    "ADV": "Idées produit / app",
    "Jarvis": "Idées produit / app",
}

_SECTION_TO_TAG: dict[str, str] = {
    "Idées produit / app": "ADV",
    "Idées business / service": "Business",
    "Idées contenu / TikTok / marketing": "TikTok",
    "Idées perso / organisation": "Perso",
}
HERMES_PERSONALIZATION_DIR = OBSIDIAN_ROOT / "JARVIS" / "50_MEMOIRE" / "HERMES_PERSONNALISATION"
RUTH_PROFILE_PATH = HERMES_PERSONALIZATION_DIR / "01_PROFIL_RUTH.md"
RUTH_PREFERENCES_PATH = HERMES_PERSONALIZATION_DIR / "02_PREFERENCES_TRAVAIL.md"
HERMES_RULES_PATH = HERMES_PERSONALIZATION_DIR / "03_REGLES_HERMES.md"
HERMES_VALIDATED_MEMORY_PATH = HERMES_PERSONALIZATION_DIR / "04_MEMOIRE_VALIDEE.md"
HERMES_LEARNING_JOURNAL_PATH = HERMES_PERSONALIZATION_DIR / "05_JOURNAL_APPRENTISSAGE.md"

_CLOUD_ENV_FILE = Path.home() / ".openjarvis" / "cloud-keys.env"
_OPENAI_BUDGET_THRESHOLDS = (
    (1.0, "Budget cloud atteint. Hermès repasse en mode local gratuit."),
    (0.95, "Attention : tu approches fortement de la limite cloud de 5 $."),
    (0.80, "Attention Ruth : Hermès approche de la limite cloud prévue."),
    (0.50, "Attention Ruth : Hermès a utilisé environ 50 % du budget cloud prévu."),
)
_HERMES_PROVIDER_PRICING: dict[str, tuple[str, float, float]] = {
    "gpt-4o-mini": ("openai", 0.15, 0.60),
    "gpt-4o": ("openai", 2.50, 10.00),
    "openrouter/google/gemini-2.5-flash": ("openrouter", 0.30, 2.50),
    "openrouter/moonshotai/kimi-k2.6": ("openrouter", 0.75, 3.50),
    "openrouter/deepseek/deepseek-r1": ("openrouter", 0.55, 2.19),
    "openrouter/qwen/qwen3-235b-a22b": ("openrouter", 0.60, 2.40),
}
_HERMES_PROVIDER_META: dict[str, dict[str, str]] = {
    "local_ollama": {"label": "Ollama local", "key_name": "", "kind": "free"},
    "openrouter": {"label": "OpenRouter", "key_name": "OPENROUTER_API_KEY", "kind": "paid"},
    "openai": {"label": "OpenAI", "key_name": "OPENAI_API_KEY", "kind": "paid"},
    "anthropic": {"label": "Anthropic", "key_name": "ANTHROPIC_API_KEY", "kind": "paid"},
    "google": {"label": "Google / Gemini", "key_name": "GOOGLE_API_KEY", "kind": "paid"},
    "gemini": {"label": "Google / Gemini", "key_name": "GEMINI_API_KEY", "kind": "paid"},
}
_HERMES_CHAT_SYSTEM_PROMPT = (
    "Tu es Hermès. Tu parles à Ruth. "
    "Ruth est la seule personne qui te parle ici. Elle n'est jamais quelqu'un d'autre. "
    "Tu n'es jamais Ruth : tu es Hermès, son assistant, un personnage différent d'elle. "
    "Si son message commence par un mot comme \"Pedro\" ou \"ADV\", c'est le nom d'un de "
    "ses projets, pas une personne à qui tu t'adresses et pas ton identité à toi. "
    "Réponds toujours à Ruth directement (\"tu\"), jamais à un tiers, jamais en disant "
    "\"je suis Ruth\". "
    "Tu réponds en français, de façon naturelle, claire, directe, protectrice et utile. "
    "Tu évites le jargon inutile. "
    "Si la demande est large, tu poses une seule question de cadrage concrète. "
    "Tu ne prétends pas avoir fait une action que tu n'as pas faite."
)


class HermesChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(default="", max_length=8000)


class HermesChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    history: list[HermesChatTurn] = Field(default_factory=list)
    engine_mode: Literal["auto", "economy", "quality", "local", "openai"] = "auto"
    session_id: str | None = None


class HermesValidationRequest(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = Field(default="", max_length=2000)


class HermesAlertActionRequest(BaseModel):
    action: Literal["fix", "create_task", "ignore"]
    alert_title: str = Field(min_length=1, max_length=300)
    alert_detail: str = Field(default="", max_length=4000)
    alert_level: str = Field(default="warning", max_length=32)
    source: str = Field(default="cockpit", max_length=64)


class HermesCodexHandoffAckRequest(BaseModel):
    handoff_id: str = Field(default="", max_length=128)
    status: Literal["received", "running", "done", "failed"]
    summary: str = Field(default="", max_length=2000)
    result_summary: str = Field(default="", max_length=4000)
    source: str = Field(default="codex", max_length=64)


class IdeaCaptureRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    tag: str = Field(default="Business")
    date: str = Field(default="")


class IdeaToggleRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    section: str = Field(default="")
    done: bool = Field(default=True)


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, path)


def _hermes_core_validation_api():
    if str(PERSONAL_ROOT) not in os.sys.path:
        os.sys.path.insert(0, str(PERSONAL_ROOT))
    from hermes_core import approve_delegation_via_core, cancel_validation_via_core, resolve_validation_via_core

    return approve_delegation_via_core, cancel_validation_via_core, resolve_validation_via_core


def _hermes_core_request_validation_api():
    if str(PERSONAL_ROOT) not in os.sys.path:
        os.sys.path.insert(0, str(PERSONAL_ROOT))
    from hermes_core import request_validation_via_core

    return request_validation_via_core


def _hermes_core_snapshot_api():
    if str(PERSONAL_ROOT) not in os.sys.path:
        os.sys.path.insert(0, str(PERSONAL_ROOT))
    from hermes_core import get_core_snapshot, refresh_memory_context

    return get_core_snapshot, refresh_memory_context


def _hermes_core_capabilities_snapshot() -> dict[str, Any]:
    # Best-effort, à la demande seulement (appelé depuis _hermes_runtime_snapshot,
    # jamais en polling continu) — skills/routines/executors et mémoire assemblée
    # existent dans hermes_core depuis longtemps mais n'étaient jamais surfacés au
    # serveur live (trouvé lors de la cartographie du 2026-08-31, confirmé par
    # Codex : branchement laissé en attente de décision, pas un oubli technique
    # documenté). Un échec ici ne doit jamais casser le reste du snapshot.
    try:
        get_core_snapshot, refresh_memory_context = _hermes_core_snapshot_api()
        core = get_core_snapshot(PERSONAL_ROOT)
        memory_payload, _path = refresh_memory_context(PERSONAL_ROOT)
        return {
            "skills": core.get("skills", []),
            "routines": core.get("routines", []),
            "executors": core.get("executors", []),
            "memory": memory_payload,
        }
    except Exception:
        return {}


def _current_hermes_validation() -> dict[str, Any]:
    core = _load_json(HERMES_CORE_STATE_PATH) or {}
    validation_state = _load_json(HERMES_VALIDATION_STATE_PATH) or {}
    voice_state = _load_json(STATE_PATH) or {}
    pending = (
        core.get("pending_validation")
        or validation_state.get("active")
        or voice_state.get("pending_validation")
        or {}
    )
    return pending if isinstance(pending, dict) else {}


def _validated_action_record(
    *,
    action: str,
    execution_status: str,
    result_summary: str = "",
    executable: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "action": action,
        "validated_at": datetime.now().isoformat(timespec="seconds"),
        "execution_status": execution_status,
    }
    if result_summary:
        payload["result_summary"] = result_summary
    if executable:
        payload["executable"] = executable
    return payload


def _sync_voice_validation_result(record: dict[str, Any] | None) -> None:
    voice_state = _load_json(STATE_PATH) or {}
    voice_state["pending_validation"] = None
    if record is not None:
        voice_state["last_validated_action"] = record
    _write_json_atomic(STATE_PATH, voice_state)


def _direct_clear_hermes_validation(
    pending: dict[str, Any],
    *,
    resolution: str,
    execution_status: str,
    result_summary: str,
) -> dict[str, Any]:
    now = datetime.now().isoformat(timespec="seconds")
    resolved = dict(pending)
    resolved.update(
        {
            "status": "resolved",
            "resolved_at": now,
            "resolution": resolution,
            "execution_status": execution_status,
            "result_summary": result_summary,
            "last_lifecycle_update_at": now,
            "lifecycle_status": "approved" if resolution == "approved" else "rejected",
        }
    )
    history = list(resolved.get("lifecycle_history") or [])
    history.append(
        {
            "status": resolved["lifecycle_status"],
            "ts": now,
            "summary": result_summary,
        }
    )
    resolved["lifecycle_history"] = history

    core = _load_json(HERMES_CORE_STATE_PATH) or {}
    core["pending_validation"] = None
    core["last_validation_lifecycle"] = {
        "action": str(resolved.get("action", "")),
        "executable": resolved.get("executable"),
        "status": "resolved",
        "lifecycle_status": resolved["lifecycle_status"],
        "resolution": resolution,
        "execution_status": execution_status,
        "approval_required": bool(resolved.get("approval_required", True)),
        "risk_level": str(resolved.get("risk_level", "")),
        "created_at": str(resolved.get("created_at", "")),
        "resolved_at": now,
        "last_lifecycle_update_at": now,
        "history": history,
    }
    core["validation_lifecycle"] = None
    core["last_recommended_action"] = str(resolved.get("action", ""))
    core["updated_at"] = now
    _write_json_atomic(HERMES_CORE_STATE_PATH, core)

    validation_state = _load_json(HERMES_VALIDATION_STATE_PATH) or {}
    validation_state["active"] = None
    validation_state["last_resolved"] = resolved
    validation_state["updated_at"] = now
    _write_json_atomic(HERMES_VALIDATION_STATE_PATH, validation_state)
    return resolved


def _hermes_core_delegation_api():
    if str(PERSONAL_ROOT) not in os.sys.path:
        os.sys.path.insert(0, str(PERSONAL_ROOT))
    from hermes_core import record_delegation_result_via_core

    return record_delegation_result_via_core


def _hermes_core_observer_api():
    if str(PERSONAL_ROOT) not in os.sys.path:
        os.sys.path.insert(0, str(PERSONAL_ROOT))
    from hermes_core import orchestrate_request_via_core

    return orchestrate_request_via_core


_HERMES_TASK_INTENT_RE = re.compile(
    r"\b(?:"
    r"il faut\s+(?:regarder|travailler|préparer|analyser|auditer|corriger|tester|terminer|continuer|reprendre|lancer|créer)"
    r"|on\s+travaille"
    r"|(?:travail(?:ler|le)|prépar(?:er|e)|analys(?:er|e)|audit(?:er|e)|corrig(?:er|e)|test(?:er|e)|termin(?:er|e)|continu(?:er|e)|reprend(?:re|s)|lanc(?:er|e)|cré(?:er|e)|fai(?:re|s))\b"
    r"|aide[\s-]*moi"
    r")\b",
    re.IGNORECASE,
)
_UNVERIFIED_RUTH_DECISION_CLAIM_RE = re.compile(
    r"\b(?:validé|validée|approuvé|approuvée|décidé|décidée)\s+(?:par|avec)\s+Ruth\b",
    re.IGNORECASE,
)


def _should_prepare_hermes_mission(message: str) -> bool:
    """Retourne vrai uniquement pour une demande de travail explicite.

    Le chat reste une conversation : une salutation, une question d'état ou
    une transcription STT dégradée ne doit jamais écraser la mission proposée.
    Une mission peut ensuite être préparée volontairement via l'UI, mais parler
    à Hermès ne crée toujours aucune validation ni délégation.
    """
    normalized = " ".join(message.split())
    meaningful = re.sub(r"[^\wÀ-ÿ]", "", normalized, flags=re.UNICODE)
    return len(meaningful) >= 8 and bool(_HERMES_TASK_INTENT_RE.search(normalized))


async def _observe_hermes_chat_request(message: str) -> None:
    """Journalise un plan Hermès sans perturber ni modifier la conversation."""
    try:
        observe = _hermes_core_observer_api()
        await asyncio.to_thread(
            observe,
            PERSONAL_ROOT,
            raw_request=message,
            input_mode="text",
            source="hermes_chat_observer",
            observation_only=True,
        )
    except Exception:
        logger.warning("Hermes observer failed; chat response remains unchanged", exc_info=True)


def _start_hermes_chat_observer(message: str) -> asyncio.Task[None]:
    """Keep the background observer alive until it has safely completed."""
    if not _should_prepare_hermes_mission(message):
        async def _no_mission() -> None:
            return None
        return asyncio.create_task(_no_mission())
    task = asyncio.create_task(_observe_hermes_chat_request(message))
    _HERMES_OBSERVER_TASKS.add(task)
    task.add_done_callback(_HERMES_OBSERVER_TASKS.discard)
    return task


def _current_hermes_execution() -> dict[str, Any]:
    payload = _load_json(HERMES_EXECUTION_STATUS_PATH) or {}
    return payload if isinstance(payload, dict) else {}


def _write_hermes_execution_status(*, status: str, mission_request_id: str, summary: str = "", error: str = "") -> None:
    _write_json_atomic(
        HERMES_EXECUTION_STATUS_PATH,
        {
            "status": status,
            "mission_request_id": mission_request_id,
            "summary": summary,
            "error": error,
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    )


def _append_recent_trace_event(*, event_type: str, status: str, tool: str, notes: str) -> None:
    event = {
        "event_type": event_type,
        "status": status,
        "tool": tool,
        "notes": notes,
    }
    current = _load_json(HERMES_RECENT_TRACE_JSON_PATH) or {}
    recent = current if isinstance(current, list) else current.get("recent_trace", [])
    if not isinstance(recent, list):
        recent = []
    recent = [item for item in recent if isinstance(item, dict)]
    recent.append(event)
    recent = recent[-20:]
    _write_json_atomic(HERMES_RECENT_TRACE_JSON_PATH, {"recent_trace": recent})
    _append_jsonl(HERMES_RECENT_TRACE_JSONL_PATH, event)


def _active_runtime_delegation_target() -> str:
    current_request = _load_json(HERMES_CURRENT_REQUEST_PATH) or {}
    current_packet = _load_json(HERMES_CURRENT_PACKET_PATH) or {}
    current_delegation = _load_json(HERMES_CURRENT_DELEGATION_PATH) or {}
    return str(
        current_delegation.get("delegation_target")
        or current_request.get("delegation_target")
        or current_packet.get("tool_id")
        or ""
    ).strip()


def _snapshot_fields(source: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    for key in fields:
        value = source.get(key)
        if value in (None, ""):
            continue
        snapshot[key] = value
    return snapshot


def _build_codex_handoff_payload(
    existing: dict[str, Any] | None = None,
    *,
    include_full: bool = False,
) -> dict[str, Any]:
    existing = existing if isinstance(existing, dict) else {}
    current_request = _load_json(HERMES_CURRENT_REQUEST_PATH) or {}
    current_packet = _load_json(HERMES_CURRENT_PACKET_PATH) or {}
    request_id = str(existing.get("request_id") or current_request.get("request_id") or "").strip()
    packet_id = str(existing.get("packet_id") or current_packet.get("packet_id") or "").strip()
    active_target = _active_runtime_delegation_target()
    existing_target = str(existing.get("target_tool") or "").strip()
    target_tool = "codex_executor"
    if existing_target == "codex_executor":
        target_tool = existing_target
    elif active_target == "codex_executor":
        target_tool = active_target

    request_snapshot = _snapshot_fields(
        current_request,
        (
            "request_id",
            "intent",
            "summary",
            "prompt",
            "project",
            "priority",
            "delegation_target",
            "delegation_status",
            "execution_status",
            "created_at",
            "updated_at",
        ),
    )
    packet_snapshot = _snapshot_fields(
        current_packet,
        (
            "packet_id",
            "tool_id",
            "task_summary",
            "expected_outcome",
            "risk_level",
            "status",
            "execution_status",
            "created_at",
            "updated_at",
        ),
    )
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    seed = f"{request_id}:{packet_id}:{target_tool or 'codex_executor'}"
    handoff_id = str(existing.get("handoff_id") or "").strip()
    if not handoff_id:
        handoff_id = f"codex-hf-{hashlib.sha1(seed.encode('utf-8')).hexdigest()[:12]}"
    payload = {
        "handoff_id": handoff_id,
        "status": str(existing.get("status") or "pending").strip() or "pending",
        "created_at": str(existing.get("created_at") or now),
        "updated_at": str(existing.get("updated_at") or now),
        "completed_at": str(existing.get("completed_at") or ""),
        "request_id": request_id,
        "packet_id": packet_id,
        "target_tool": target_tool or "codex_executor",
        "title": str(existing.get("title") or "Codex handoff"),
        "summary": str(existing.get("summary") or ""),
        "result_summary": str(existing.get("result_summary") or ""),
        "source": str(existing.get("source") or "hermes_runtime"),
        "last_source": str(existing.get("last_source") or ""),
        "request_snapshot": request_snapshot,
        "packet_snapshot": packet_snapshot,
    }
    if include_full:
        payload["request"] = current_request
        payload["packet"] = current_packet
    return payload


def _sync_runtime_delegation_progress(*, status: str, summary: str, source: str) -> bool:
    current_request = _load_json(HERMES_CURRENT_REQUEST_PATH) or {}
    current_delegation = _load_json(HERMES_CURRENT_DELEGATION_PATH) or {}
    active_target = _active_runtime_delegation_target()
    if active_target and active_target != "codex_executor":
        return False
    if isinstance(current_request, dict):
        current_request["codex_handoff_status"] = status
        current_request["execution_status"] = status
        current_request["delegation_status"] = status
        if summary:
            current_request["codex_handoff_summary"] = summary
        _write_json_atomic(HERMES_CURRENT_REQUEST_PATH, current_request)
    if isinstance(current_delegation, dict):
        current_delegation["codex_handoff_status"] = status
        current_delegation["delegation_status"] = status
        if summary:
            current_delegation["handoff_summary"] = summary
        _write_json_atomic(HERMES_CURRENT_DELEGATION_PATH, current_delegation)

    core_state = _load_json(HERMES_CORE_STATE_PATH) or {}
    if isinstance(core_state, dict):
        state_request = core_state.get("current_request") if isinstance(core_state.get("current_request"), dict) else {}
        state_delegation = core_state.get("current_delegation") if isinstance(core_state.get("current_delegation"), dict) else {}
        state_request.update(current_request)
        state_delegation.update(current_delegation)
        core_state["current_request"] = state_request
        core_state["current_delegation"] = state_delegation
        core_state["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _write_json_atomic(HERMES_CORE_STATE_PATH, core_state)

    _append_recent_trace_event(
        event_type="codex_handoff_status",
        status=status,
        tool="codex_executor",
        notes=summary or f"Codex handoff status={status} ({source})",
    )
    return True


def _bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except Exception:
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw.strip())
    except Exception:
        return default


def _load_cloud_keys() -> dict[str, str]:
    keys: dict[str, str] = {}
    if _CLOUD_ENV_FILE.exists():
        for raw in _CLOUD_ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                keys[k.strip()] = v.strip()
    for name in (
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "OPENROUTER_API_KEY",
    ):
        value = os.environ.get(name)
        if value:
            keys[name] = value
    return keys


def _sync_cloud_keys_into_env() -> dict[str, str]:
    keys = _load_cloud_keys()
    for key, value in keys.items():
        if value:
            os.environ[key] = value
    return keys


def _hermes_chat_config() -> dict[str, Any]:
    return {
        "openai_enabled": _bool_env("HERMES_OPENAI_ENABLED", True),
        "openai_model": os.environ.get("HERMES_OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini",
        "openrouter_enabled": _bool_env("HERMES_OPENROUTER_ENABLED", True),
        "openrouter_economy_model": os.environ.get(
            "HERMES_OPENROUTER_ECONOMY_MODEL",
            "openrouter/google/gemini-2.5-flash",
        ).strip()
        or "openrouter/google/gemini-2.5-flash",
        "openrouter_quality_model": os.environ.get(
            "HERMES_OPENROUTER_QUALITY_MODEL",
            "openrouter/moonshotai/kimi-k2.6",
        ).strip()
        or "openrouter/moonshotai/kimi-k2.6",
        "openrouter_code_model": os.environ.get(
            "HERMES_OPENROUTER_CODE_MODEL",
            "openrouter/moonshotai/kimi-k2.6",
        ).strip()
        or "openrouter/moonshotai/kimi-k2.6",
        "local_model": os.environ.get("HERMES_LOCAL_MODEL", "qwen3:0.6b").strip() or "qwen3:0.6b",
        "max_tokens_per_reply": max(64, _int_env("HERMES_MAX_TOKENS_PER_REPLY", 350)),
        "daily_message_limit": max(1, _int_env("HERMES_DAILY_MESSAGE_LIMIT", 40)),
        "monthly_budget_usd": max(0.5, _float_env("HERMES_MONTHLY_BUDGET_USD", 5.0)),
    }


def _safe_read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except Exception:
                    continue
                if isinstance(item, dict):
                    rows.append(item)
    except Exception:
        return []
    return rows


def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


def _day_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def _budget_state(config: dict[str, Any]) -> dict[str, Any]:
    now = _utcnow()
    current_month = _month_key(now)
    current_day = _day_key(now)
    entries = _safe_read_jsonl(HERMES_OPENAI_USAGE_LOG_PATH)
    month_entries = [entry for entry in entries if str(entry.get("month_key", "")) == current_month]
    day_entries = [entry for entry in month_entries if str(entry.get("day_key", "")) == current_day]
    month_cost = round(sum(float(entry.get("estimated_cost_usd", 0.0) or 0.0) for entry in month_entries), 6)
    day_cost = round(sum(float(entry.get("estimated_cost_usd", 0.0) or 0.0) for entry in day_entries), 6)
    day_messages = len(day_entries)
    budget = float(config["monthly_budget_usd"])
    usage_ratio = 0.0 if budget <= 0 else month_cost / budget
    threshold_ratio = 0.0
    threshold_message = ""
    for ratio, message in _OPENAI_BUDGET_THRESHOLDS:
        if usage_ratio >= ratio:
            threshold_ratio = ratio
            threshold_message = message
            break
    blocked = usage_ratio >= 1.0
    keys = _load_cloud_keys()
    provider_map: dict[str, dict[str, Any]] = {}
    for provider_id, meta in _HERMES_PROVIDER_META.items():
        key_name = meta["key_name"]
        configured = bool(key_name and keys.get(key_name, "").strip()) if key_name else True
        provider_map[provider_id] = {
            "id": provider_id,
            "label": meta["label"],
            "kind": meta["kind"],
            "configured": configured,
            "estimated_today_usd": 0.0,
            "estimated_month_usd": 0.0,
            "last_model": "",
            "last_used_at": "",
        }
    for entry in month_entries:
        provider_id = str(entry.get("provider") or "unknown").strip() or "unknown"
        if provider_id not in provider_map:
            provider_map[provider_id] = {
                "id": provider_id,
                "label": provider_id,
                "kind": "paid",
                "configured": True,
                "estimated_today_usd": 0.0,
                "estimated_month_usd": 0.0,
                "last_model": "",
                "last_used_at": "",
            }
        provider_map[provider_id]["estimated_month_usd"] = round(
            float(provider_map[provider_id]["estimated_month_usd"]) + float(entry.get("estimated_cost_usd", 0.0) or 0.0),
            6,
        )
        if str(entry.get("day_key", "")) == current_day:
            provider_map[provider_id]["estimated_today_usd"] = round(
                float(provider_map[provider_id]["estimated_today_usd"]) + float(entry.get("estimated_cost_usd", 0.0) or 0.0),
                6,
            )
        provider_map[provider_id]["last_model"] = str(entry.get("model") or provider_map[provider_id]["last_model"])
        provider_map[provider_id]["last_used_at"] = str(entry.get("timestamp") or provider_map[provider_id]["last_used_at"])
    providers = sorted(
        provider_map.values(),
        key=lambda item: (
            0 if item["id"] == "local_ollama" else 1,
            0 if item["configured"] else 1,
            -float(item["estimated_month_usd"]),
            item["label"],
        ),
    )
    state = {
        "openai_enabled": bool(config["openai_enabled"]),
        "budget_month_usd": budget,
        "estimated_today_usd": day_cost,
        "estimated_month_usd": month_cost,
        "budget_remaining_usd": round(max(0.0, budget - month_cost), 6),
        "estimated_usage_ratio": round(usage_ratio, 4),
        "daily_message_count": day_messages,
        "daily_message_limit": int(config["daily_message_limit"]),
        "blocked": blocked,
        "threshold_ratio": threshold_ratio,
        "threshold_message": threshold_message,
        "month_key": current_month,
        "day_key": current_day,
        "providers": providers,
        "configured_provider_count": sum(1 for item in providers if item["configured"] and item["id"] != "local_ollama"),
        "log_path": str(HERMES_OPENAI_USAGE_LOG_PATH),
        "updated_at": now.isoformat(timespec="seconds"),
        "warning_level": (
            "blocked" if blocked else "critical" if usage_ratio >= 0.95 else "warning" if usage_ratio >= 0.5 else "ok"
        ),
    }
    HERMES_OPENAI_BUDGET_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    HERMES_OPENAI_BUDGET_STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return state


def _short_hermes_context() -> str:
    core = _load_json(HERMES_CORE_STATE_PATH) or {}
    next_actions = (_load_json(HERMES_NEXT_ACTIONS_PATH) or {}).get("actions", [])
    route = _load_json(HERMES_PROJECT_ROUTE_PATH) or {}
    personalization = _hermes_personalization_summary()
    snippets: list[str] = []
    active_intent = str(core.get("active_intent", "")).strip()
    if active_intent:
        snippets.append(f"Intent actif : {active_intent}")
    last_summary = str(core.get("last_summary", "")).strip()
    if last_summary:
        snippets.append(f"Dernier résumé : {last_summary}")
    route_step = str(route.get("next_safe_step", "")).strip()
    if route_step:
        snippets.append(f"Prochain pas recommandé : {route_step}")
    if isinstance(next_actions, list) and next_actions:
        compact_actions = []
        for item in next_actions[:3]:
            if isinstance(item, dict):
                label = str(item.get("label", "")).strip()
            else:
                label = str(item).strip()
            if label:
                compact_actions.append(label)
        if compact_actions:
            snippets.append("Prochaines actions : " + " | ".join(compact_actions))
    for line in personalization.get("summary_lines", [])[:3]:
        snippets.append(line)
    return "\n".join(snippets)


def _project_block_status_reply(message: str) -> str | None:
    """Answer a project-block question only from published project state.

    This fast path avoids both a cloud call and a plausible but false answer
    when a voice transcript contains a project/block request.  It purposely
    does not infer a missing next block from prose.
    """
    if not re.search(r"(?i)\bblocs?\b", message):
        return None

    message_tokens = set(re.findall(r"[\w-]{3,}", message.casefold()))
    candidates: list[dict[str, Any]] = []
    for item in _published_project_states().get("projects", []):
        project = item.get("project") if isinstance(item, dict) else None
        if not isinstance(project, dict):
            continue
        aliases = set(re.findall(r"[\w-]{3,}", f"{project.get('id', '')} {project.get('name', '')}".casefold()))
        if aliases & message_tokens:
            candidates.append(item)

    if not candidates:
        return None
    if len(candidates) > 1:
        names = ", ".join(str(item["project"]["name"]) for item in candidates)
        return f"Je vois plusieurs projets possibles ({names}). Lequel veux-tu suivre ?"

    item = candidates[0]
    project = item["project"]
    state = item.get("state") if isinstance(item.get("state"), dict) else {}
    name = str(project.get("name") or "ce projet")
    active_block = str(state.get("active_block") or "").strip()
    next_action = str(state.get("next_action") or "").strip()
    if not active_block and not next_action:
        return f"Je reconnais {name}, mais aucun bloc publié n’est disponible. Je ne vais pas en inventer un."

    parts = [f"Pour {name}, le bloc actif publié est {active_block.rstrip('.!? ')}." if active_block else f"Pour {name}, aucun bloc actif n’est publié."]
    if next_action:
        parts.append(f"Prochaine action publiée : {next_action.rstrip('.!? ')}.")
    else:
        parts.append("La source ne publie pas encore de prochain bloc ; je ne vais pas le deviner.")
    return " ".join(parts)


def _hermes_messages(message: str, history: list[HermesChatTurn]) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": _HERMES_CHAT_SYSTEM_PROMPT}]
    short_context = _short_hermes_context()
    if short_context:
        messages.append(
            {
                "role": "system",
                "content": "Contexte local Jarvis/Hermès compact :\n" + short_context,
            }
        )
    for item in history[-8:]:
        content = item.content.strip()
        if not content:
            continue
        messages.append({"role": item.role, "content": content})
    messages.append({"role": "user", "content": message.strip()})
    return messages


def _resolve_local_model(engine: Any, preferred_model: str) -> str:
    try:
        models = list(engine.list_models())
    except Exception:
        models = []
    if preferred_model in models:
        return preferred_model
    for candidate in models:
        if not any(candidate.startswith(prefix) for prefix in ("gpt-", "o1-", "o3-", "o4-", "claude-", "gemini-", "openrouter/")):
            return candidate
    return preferred_model


async def _call_openai_chat(
    *,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    api_key_override: str = "",
) -> dict[str, Any]:
    keys = _sync_cloud_keys_into_env()
    api_key = api_key_override.strip() or keys.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY manquant. Configure OpenAI dans les paramètres OpenJarvis.")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.45,
        "max_tokens": max_tokens,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        data = response.json()
    choice = (data.get("choices") or [{}])[0]
    reply = str(((choice.get("message") or {}).get("content")) or "").strip()
    usage = data.get("usage") or {}
    return {
        "reply": reply or "Je n’ai pas reçu de réponse exploitable du moteur OpenAI.",
        "usage": {
            "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0),
            "completion_tokens": int(usage.get("completion_tokens", 0) or 0),
            "total_tokens": int(usage.get("total_tokens", 0) or 0),
        },
    }


async def _call_openrouter_chat(
    *,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    api_key_override: str = "",
) -> dict[str, Any]:
    keys = _sync_cloud_keys_into_env()
    api_key = api_key_override.strip() or keys.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY manquant. Configure OpenRouter dans les paramètres backend Hermès.")
    actual_model = model.removeprefix("openrouter/")
    payload = {
        "model": actual_model,
        "messages": messages,
        "temperature": 0.45,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://127.0.0.1:8000",
                "X-Title": "Hermes Ruth Local",
            },
        )
        response.raise_for_status()
        data = response.json()
    choice = (data.get("choices") or [{}])[0]
    reply = str(((choice.get("message") or {}).get("content")) or "").strip()
    usage = data.get("usage") or {}
    if not reply:
        raise RuntimeError(f"OpenRouter a renvoyé une réponse vide pour {actual_model}.")
    return {
        "reply": reply,
        "usage": {
            "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0),
            "completion_tokens": int(usage.get("completion_tokens", 0) or 0),
            "total_tokens": int(usage.get("total_tokens", 0) or 0),
        },
    }


def _call_local_chat(
    *,
    engine: Any,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int,
) -> dict[str, Any]:
    from openjarvis.core.types import Message, Role

    mapped = []
    for item in messages:
        role = Role.SYSTEM
        if item["role"] == "assistant":
            role = Role.ASSISTANT
        elif item["role"] == "user":
            role = Role.USER
        mapped.append(Message(role=role, content=item["content"]))
    result = engine.generate(
        mapped,
        model=model,
        temperature=0.45,
        max_tokens=max_tokens,
    )
    usage = result.get("usage") or {}
    return {
        "reply": str(result.get("content", "") or "").strip() or "Je n’ai pas réussi à produire une réponse locale exploitable.",
        "usage": {
            "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0),
            "completion_tokens": int(usage.get("completion_tokens", 0) or 0),
            "total_tokens": int(usage.get("total_tokens", 0) or 0),
        },
    }


def _estimate_paid_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    from openjarvis.engine.cloud import estimate_cost

    pricing = _HERMES_PROVIDER_PRICING.get(model)
    if pricing is not None:
        _, input_cost_per_m, output_cost_per_m = pricing
        return round(
            (prompt_tokens / 1_000_000) * input_cost_per_m
            + (completion_tokens / 1_000_000) * output_cost_per_m,
            6,
        )
    return round(estimate_cost(model, prompt_tokens, completion_tokens), 6)


def _record_paid_usage(
    *,
    provider: str,
    model: str,
    usage: dict[str, int],
    route: str,
    session_id: str | None,
) -> dict[str, Any]:
    now = _utcnow()
    prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
    completion_tokens = int(usage.get("completion_tokens", 0) or 0)
    estimated_cost = _estimate_paid_cost(model, prompt_tokens, completion_tokens)
    entry = {
        "timestamp": now.isoformat(timespec="seconds"),
        "month_key": _month_key(now),
        "day_key": _day_key(now),
        "provider": provider,
        "model": model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": int(usage.get("total_tokens", prompt_tokens + completion_tokens) or 0),
        "estimated_cost_usd": estimated_cost,
        "route": route,
        "session_id": session_id or "",
    }
    _append_jsonl(HERMES_OPENAI_USAGE_LOG_PATH, entry)
    return entry


def _hermes_chat_runtime_summary() -> dict[str, Any]:
    config = _hermes_chat_config()
    keys = _load_cloud_keys()
    budget = _budget_state(config)
    personalization = _hermes_personalization_summary()
    openai_configured = bool(keys.get("OPENAI_API_KEY", "").strip())
    openrouter_configured = bool(keys.get("OPENROUTER_API_KEY", "").strip())
    paid_available = (
        (bool(config["openrouter_enabled"]) and openrouter_configured)
        or (bool(config["openai_enabled"]) and openai_configured)
    ) and not bool(budget["blocked"])
    local_limited = not paid_available
    status = "local_limited" if local_limited else "paid_ready"
    return {
        "recommended_engine": "economy" if status == "paid_ready" else "local",
        "preferred_provider": "openrouter" if openrouter_configured else "openai" if openai_configured else "local_ollama",
        "openai_enabled": bool(config["openai_enabled"]),
        "openai_configured": openai_configured,
        "openrouter_enabled": bool(config["openrouter_enabled"]),
        "openrouter_configured": openrouter_configured,
        "openai_model": config["openai_model"],
        "openrouter_economy_model": config["openrouter_economy_model"],
        "openrouter_quality_model": config["openrouter_quality_model"],
        "openrouter_code_model": config["openrouter_code_model"],
        "local_model": config["local_model"],
        "max_tokens_per_reply": config["max_tokens_per_reply"],
        "daily_message_limit": config["daily_message_limit"],
        "budget": budget,
        "status": status,
        "status_message": (
            "Modes payants prêts : OpenRouter recommandé, OpenAI en secours."
            if status == "paid_ready"
            else "Hermès est actuellement en mode local limité."
        ),
        "selection_reason": (
            "OpenRouter est prioritaire pour les échanges normaux afin de limiter le coût, avec OpenAI en secours et local gratuit en dernier recours."
            if status == "paid_ready"
            else "Aucun provider cloud exploitable n’est prêt ou le budget est bloqué, donc Hermès reste en local gratuit."
        ),
        "personalization": personalization,
        "available_modes": ["local", "economy", "quality", "auto"],
    }


def _select_hermes_provider(message: str, mode: str, config: dict[str, Any], runtime: dict[str, Any]) -> tuple[str, str]:
    text = message.lower()
    if mode == "local":
        return ("local", str(config["local_model"]))
    if mode == "openai":
        return ("openai", str(config["openai_model"]))
    if mode == "economy":
        return ("openrouter", str(config["openrouter_economy_model"]))
    if mode == "quality":
        if any(keyword in text for keyword in ("code", "landing page", "ui", "ux", "refactor", "orchestration", "agent")):
            return ("openrouter", str(config["openrouter_code_model"]))
        return ("openrouter", str(config["openrouter_quality_model"]))
    if any(keyword in text for keyword in ("juridique", "legal", "contrat", "finance", "facture", "sensible", "confidentiel")):
        return ("openai", str(config["openai_model"]))
    if any(keyword in text for keyword in ("code", "landing page", "ui", "ux", "refactor", "orchestration", "agent")):
        return ("openrouter", str(config["openrouter_code_model"]))
    if len(text.strip()) < 80 and text.count("?") <= 1 and not any(keyword in text for keyword in ("adv", "jarvis", "herm", "projet", "strategie", "stratégie", "bloc", "pedro", "edupilot")):
        return ("local", str(config["local_model"]))
    if runtime.get("openrouter_configured"):
        return ("openrouter", str(config["openrouter_economy_model"]))
    if runtime.get("openai_configured"):
        return ("openai", str(config["openai_model"]))
    return ("local", str(config["local_model"]))


def _describe_hermes_provider_choice(message: str, mode: str, provider: str, model: str, runtime: dict[str, Any]) -> str:
    text = message.lower()
    if mode == "local":
        return f"Mode local uniquement demandé. Hermès utilise {model} sans coût cloud."
    if mode == "economy":
        return f"Mode économique demandé. Hermès privilégie {provider} avec {model} pour réduire le coût."
    if mode == "quality":
        return f"Mode qualité demandé. Hermès privilégie {provider} avec {model} pour une réponse plus solide."
    if mode == "openai":
        return f"Mode OpenAI demandé. Hermès utilise {model} comme moteur principal."
    if provider == "openai":
        return "Hermès a choisi OpenAI car la demande semble plus sensible ou demande une fiabilité supplémentaire."
    if provider == "openrouter" and any(
        keyword in text for keyword in ("code", "landing page", "ui", "ux", "refactor", "orchestration", "agent")
    ):
        return f"Hermès a choisi {model} pour une tâche plus structurée de code, UI ou orchestration."
    if provider == "openrouter":
        return f"Hermès a choisi {model} pour garder une bonne qualité tout en limitant le coût."
    return "Hermès a choisi le mode local gratuit car la demande paraît simple ou les providers cloud ne sont pas disponibles."


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _load_jsonl_tail(path: Path, limit: int) -> list[dict[str, Any]]:
    """Return recent JSONL records without parsing an unbounded history file.

    Voice sessions are append-only and can grow very large.  The cockpit only
    renders a small recent window, so walking the full file makes the UI slower
    as history grows.  Read fixed-size blocks from the end instead.
    """
    if not path.exists():
        return []
    if limit <= 0:
        return []
    rows: list[dict[str, Any]] = []
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            position = handle.tell()
            remainder = b""
            while position > 0 and len(rows) < limit:
                read_size = min(8192, position)
                position -= read_size
                handle.seek(position)
                chunk = handle.read(read_size) + remainder
                lines = chunk.split(b"\n")
                remainder = lines[0]
                for raw_line in reversed(lines[1:]):
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        rows.append(json.loads(line.decode("utf-8")))
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        continue
                    if len(rows) == limit:
                        break
            if len(rows) < limit and remainder.strip():
                try:
                    rows.append(json.loads(remainder.strip().decode("utf-8")))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    pass
    except Exception:
        return []
    rows.reverse()
    return rows


def _load_toml(path: Path) -> dict[str, Any]:
    if not path.exists() or tomllib is None:
        return {}
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except Exception:
        return {}


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _extract_markdown_bullets(markdown: str, *, limit: int = 5) -> list[str]:
    rows: list[str] = []
    for raw in markdown.splitlines():
        line = raw.strip()
        if not line.startswith("- "):
            continue
        item = line[2:].strip()
        if not item:
            continue
        rows.append(item)
        if len(rows) >= limit:
            break
    return rows


def _hermes_personalization_summary() -> dict[str, Any]:
    profile = _read_text(RUTH_PROFILE_PATH)
    preferences = _read_text(RUTH_PREFERENCES_PATH)
    rules = _read_text(HERMES_RULES_PATH)
    memory = _read_text(HERMES_VALIDATED_MEMORY_PATH)
    learning = _read_text(HERMES_LEARNING_JOURNAL_PATH)

    profile_bits = _extract_markdown_bullets(profile, limit=6)
    preference_bits = _extract_markdown_bullets(preferences, limit=6)
    rule_bits = _extract_markdown_bullets(rules, limit=6)
    memory_bits = _extract_markdown_bullets(memory, limit=6)
    learning_bits = _extract_markdown_bullets(learning, limit=4)

    summary_lines: list[str] = []
    if profile_bits:
        summary_lines.append("Profil Ruth : " + " | ".join(profile_bits[:3]))
    if preference_bits:
        summary_lines.append("Préférences : " + " | ".join(preference_bits[:4]))
    if rule_bits:
        summary_lines.append("Règles Hermès : " + " | ".join(rule_bits[:4]))
    if memory_bits:
        summary_lines.append("Mémoire validée : " + " | ".join(memory_bits[:4]))
    if learning_bits:
        summary_lines.append("Apprentissage récent : " + " | ".join(learning_bits[:3]))

    return {
        "summary_lines": summary_lines,
        "profile": profile_bits,
        "preferences": preference_bits,
        "rules": rule_bits,
        "validated_memory": memory_bits,
        "learning_journal": learning_bits,
        "sources": [
            {"label": "Profil Ruth", "path": str(RUTH_PROFILE_PATH), "exists": RUTH_PROFILE_PATH.exists()},
            {"label": "Préférences travail", "path": str(RUTH_PREFERENCES_PATH), "exists": RUTH_PREFERENCES_PATH.exists()},
            {"label": "Règles Hermès", "path": str(HERMES_RULES_PATH), "exists": HERMES_RULES_PATH.exists()},
            {"label": "Mémoire validée", "path": str(HERMES_VALIDATED_MEMORY_PATH), "exists": HERMES_VALIDATED_MEMORY_PATH.exists()},
            {"label": "Journal apprentissage", "path": str(HERMES_LEARNING_JOURNAL_PATH), "exists": HERMES_LEARNING_JOURNAL_PATH.exists()},
        ],
    }
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except Exception:
        return {}


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _relative_seconds(raw: str | None) -> int | None:
    dt = _parse_iso(raw)
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, int((_utcnow() - dt.astimezone(timezone.utc)).total_seconds()))


def _tail_handoffs(limit: int = 4) -> list[dict[str, str]]:
    if not HANDOFFS_PATH.exists():
        return []
    try:
        text = HANDOFFS_PATH.read_text(encoding="utf-8")
    except Exception:
        return []
    chunks = re.split(r"^##\s+", text, flags=re.M)
    items: list[dict[str, str]] = []
    for chunk in chunks[1:]:
        lines = [line.rstrip() for line in chunk.strip().splitlines() if line.strip()]
        if not lines:
            continue
        heading = lines[0]
        bullets = [line for line in lines[1:] if line.startswith("- ")]
        items.append(
            {
                "heading": heading,
                "summary": " ".join(bullets[:3]).replace("- ", "").strip(),
            }
        )
    return items[-limit:]


def _normalize_status(value: Any) -> str:
    raw = str(value or "unknown").strip().lower()
    if raw in {"ok", "ready", "connected", "clean", "active", "success"}:
        return "ok"
    if raw in {"warning", "warn", "degraded", "partial", "stale"}:
        return "warning"
    if raw in {"error", "failed", "missing", "blocked", "critical"}:
        return "error"
    return raw or "unknown"


def _status_rank(status: str) -> int:
    normalized = _normalize_status(status)
    if normalized == "error":
        return 3
    if normalized == "warning":
        return 2
    if normalized == "ok":
        return 0
    return 1


def _best_connector_summary(name: str, status: str, services: dict[str, Any]) -> str:
    degraded = [
        f"{key}: {value}"
        for key, value in services.items()
        if _status_rank(str(value)) >= 2
    ]
    if degraded:
        return f"{name} attention sur {', '.join(degraded[:2])}"
    if services:
        healthy = [key for key, value in services.items() if _normalize_status(value) == "ok"]
        if healthy:
            return f"{name} prêt: {', '.join(healthy[:3])}"
    if status == "ok":
        return f"{name} prêt"
    if status == "warning":
        return f"{name} à surveiller"
    if status == "error":
        return f"{name} bloqué"
    return f"{name} statut {status}"


def _connector_entry(name: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    payload = payload or {}
    services = payload.get("services", {})
    primary = next((str(v) for v in services.values() if v), payload.get("status", "unknown"))
    updated_at = str(payload.get("updated_at", ""))
    status = _normalize_status(primary)
    return {
        "name": name,
        "status": status,
        "services": services,
        "updated_at": updated_at,
        "stale_seconds": _relative_seconds(updated_at),
        "attention_needed": _status_rank(status) >= 2,
        "summary": _best_connector_summary(name, status, services),
        "details": payload,
    }


def _connector_rank(entry: dict[str, Any]) -> tuple[int, str]:
    name = str(entry.get("name", "")).lower()
    status = str(entry.get("status", "unknown")).lower()
    if name == "hermes":
        return (0, name)
    if "ok" in status:
        return (1, name)
    if any(token in status for token in {"prepared", "warning", "degraded"}):
        return (2, name)
    return (3, name)


def _hermes_runtime_snapshot() -> dict[str, dict[str, Any]]:
    return {
        "core_state": _load_json(HERMES_CORE_STATE_PATH) or {},
        "observability": _load_json(HERMES_OBSERVABILITY_PATH) or {},
        "next_actions": _load_json(HERMES_NEXT_ACTIONS_PATH) or {},
        "risk_guard": _load_json(HERMES_RISK_GUARD_PATH) or {},
        "session_closer": _load_json(HERMES_SESSION_CLOSER_PATH) or {},
        "project_route": _load_json(HERMES_PROJECT_ROUTE_PATH) or {},
        "capabilities": _hermes_core_capabilities_snapshot(),
    }


def _load_recent_trace() -> list[dict[str, Any]]:
    json_trace = _load_json(HERMES_RECENT_TRACE_JSON_PATH)
    if isinstance(json_trace, list):
        return [item for item in json_trace if isinstance(item, dict)]
    if isinstance(json_trace, dict):
        nested = json_trace.get("recent_trace")
        if isinstance(nested, list):
            return [item for item in nested if isinstance(item, dict)]
    return _load_jsonl_tail(HERMES_RECENT_TRACE_JSONL_PATH, 12)


def _empty_snapshot(error_detail: str = "") -> dict[str, Any]:
    detail = error_detail or "Le cockpit local n'a pas pu compiler son snapshot complet."
    return {
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "personal_root": str(PERSONAL_ROOT),
            "voice_runtime": str(VOICE_DIR),
        },
        "general_state": {
            "status": "warning",
            "live_status": "degraded",
            "paused": False,
            "active_until": "",
            "updated_at": "",
            "age_seconds": None,
            "turn_count": 0,
            "last_transcription": "",
            "last_response": "",
            "active_intent": "",
            "last_recommended_action": "",
            "last_skill_run": None,
        },
        "priorities": {
            "primary": "Relancer le cockpit local proprement",
            "secondary": [detail],
            "pending_validation": False,
            "source": "fallback_snapshot",
        },
        "attention_now": [
            {
                "level": "warning",
                "title": "Snapshot cockpit dégradé",
                "detail": detail,
            }
        ],
        "signals": {
            "hermes": {"status": "warning"},
            "voice": {"status": "warning"},
            "yahoo": {"status": "unknown"},
        },
        "voice_live": {
            "config_status": "",
            "wake_word": "",
            "vad": "",
            "stt": "",
            "tts": "",
            "commands": [],
            "last_updated_at": "",
        },
        "latest_transcription": "",
        "latest_response": "",
        "pending_validation": None,
        "session_history": [],
        "recent_actions": [],
        "connectors": [],
        "connectors_overview": {"healthy": [], "attention": [], "offline": []},
        "alerts": [
            {
                "level": "warning",
                "title": "Cockpit en mode dégradé",
                "detail": detail,
            }
        ],
        "continuity": [],
        "priority_lane": {
            "headline": "Cockpit à recharger",
            "detail": detail,
            "source": "fallback_snapshot",
            "severity": "warning",
            "target_id": "cockpit-fallback",
        },
        "hermes": {
            "overall": "warning",
            "active_intent": "",
            "last_summary": "",
            "last_recommended_action": "",
            "last_skill_run": None,
            "next_actions": [],
            "risk_guard": {},
            "session_closer": {},
            "project_route": {},
            "orchestrator": {},
            "delegation": {},
            "tool_research": {},
            "status_summary": {},
            "priority_summary": {},
        },
        "file_health": {},
    }


def _orchestrator_payload(core_state: dict[str, Any]) -> dict[str, Any]:
    current_request = _load_json(HERMES_CURRENT_REQUEST_PATH)
    current_packet = _load_json(HERMES_CURRENT_PACKET_PATH)
    current_tool_decision = _load_json(HERMES_CURRENT_TOOL_DECISION_PATH)
    current_delegation = _load_json(HERMES_CURRENT_DELEGATION_PATH)
    current_tool_research = _load_json(HERMES_CURRENT_TOOL_RESEARCH_PATH)
    current_codex_handoff = _load_json(HERMES_CURRENT_CODEX_HANDOFF_PATH)
    recent_trace = _load_recent_trace()
    return {
        "current_request": current_request or core_state.get("current_request"),
        "current_packet": current_packet or core_state.get("current_packet"),
        "current_tool_decision": current_tool_decision or core_state.get("current_tool_decision"),
        "current_delegation": current_delegation or core_state.get("current_delegation"),
        "current_tool_research": current_tool_research or core_state.get("current_tool_research"),
        "current_codex_handoff": current_codex_handoff or {},
        "recent_trace": recent_trace or core_state.get("recent_trace") or [],
    }


def _delegation_summary(
    core_state: dict[str, Any],
    orchestrator: dict[str, Any],
    handoffs: list[dict[str, str]],
) -> dict[str, Any]:
    request = (orchestrator.get("current_request") if isinstance(orchestrator, dict) else None) or core_state.get("current_request") or core_state.get("active_request") or {}
    packet = (orchestrator.get("current_packet") if isinstance(orchestrator, dict) else None) or core_state.get("current_packet") or core_state.get("current_execution_packet") or {}
    decision = (orchestrator.get("current_tool_decision") if isinstance(orchestrator, dict) else None) or core_state.get("current_tool_decision") or {}
    delegation = (orchestrator.get("current_delegation") if isinstance(orchestrator, dict) else None) or core_state.get("current_delegation") or {}
    pending_validation = core_state.get("pending_validation") or {}
    candidate_tools = decision.get("candidate_tools") if isinstance(decision.get("candidate_tools"), list) else []
    secondary_tools = decision.get("secondary_tools") if isinstance(decision.get("secondary_tools"), list) else packet.get("secondary_tools") if isinstance(packet.get("secondary_tools"), list) else []

    request_status = str(request.get("execution_status") or "").strip().lower()
    packet_status = str(packet.get("execution_status") or "").strip().lower()
    delegation_target = str(
        decision.get("recommended_tool")
        or packet.get("tool_id")
        or packet.get("delegate_to")
        or ""
    ).strip()

    packet_ready = bool(packet) and packet_status in {
        "prepared",
        "prepared_not_executed",
        "ready",
        "queued",
        "handoff_ready",
    }
    if pending_validation:
        delegation_status = "awaiting_validation"
    elif packet_ready:
        delegation_status = packet_status or "prepared"
    elif delegation_target:
        delegation_status = "routed"
    elif request_status:
        delegation_status = request_status
    else:
        delegation_status = "inactive"

    validation_required = bool(request.get("validation_required") or packet.get("validation_required"))
    if pending_validation:
        validation_status = "pending"
    elif validation_required:
        validation_status = "required"
    elif request or packet:
        validation_status = "not_required"
    else:
        validation_status = "unknown"

    domain = str(request.get("classified_domain") or packet.get("domain") or "").strip()
    work_type = str(request.get("classified_work_type") or packet.get("work_type") or "").strip()
    if domain or work_type or delegation_target:
        parts = [part for part in [domain, work_type] if part]
        lead = " / ".join(parts) if parts else "Demande Hermes"
        target_suffix = f" -> {delegation_target}" if delegation_target else ""
        handoff_summary = f"{lead}{target_suffix}"
    elif handoffs:
        handoff_summary = str(handoffs[0].get("summary", "")).strip()
    else:
        handoff_summary = ""

    known_registry = any(str(item.get("tool_id", "")).strip() == delegation_target for item in candidate_tools if isinstance(item, dict))
    dynamic_discovery_required = bool(request.get("dynamic_discovery_required") or decision.get("dynamic_discovery_required"))
    tool_resolution_mode = str(
        delegation.get("tool_resolution_mode")
        or request.get("routing_mode")
        or decision.get("routing_mode")
        or ("dynamic_discovery_required" if dynamic_discovery_required else "")
        or ("known_registry" if known_registry else "")
        or ("direct_target" if delegation_target else "unknown")
    ).strip()
    tool_resolution_cost = str(
        delegation.get("tool_resolution_cost")
        or request.get("cost_level")
        or decision.get("cost_level")
        or "unknown"
    ).strip()

    fallback_target = str(
        delegation.get("tool_fallback")
        or decision.get("fallback_tool")
        or ", ".join(str(item).strip() for item in secondary_tools if str(item).strip())
    ).strip()

    lifecycle = core_state.get("validation_lifecycle") or {}
    last_lifecycle = core_state.get("last_validation_lifecycle") or {}
    if not isinstance(lifecycle, dict):
        lifecycle = {}
    if not isinstance(last_lifecycle, dict):
        last_lifecycle = {"lifecycle_status": str(last_lifecycle)}
    lifecycle_status = str(
        lifecycle.get("lifecycle_status")
        or last_lifecycle.get("lifecycle_status")
        or ""
    ).strip()
    result_status = str(
        delegation.get("result_status")
        or request.get("execution_status")
        or lifecycle_status
        or ""
    ).strip()
    result_summary = str(
        delegation.get("result_summary")
        or delegation.get("handoff_summary")
        or lifecycle.get("result_summary")
        or last_lifecycle.get("result_summary")
        or ""
    ).strip()
    result_logged_at = str(
        delegation.get("result_logged_at")
        or lifecycle.get("result_logged_at")
        or lifecycle.get("executed_at")
        or lifecycle.get("last_lifecycle_update_at")
        or last_lifecycle.get("result_logged_at")
        or last_lifecycle.get("executed_at")
        or last_lifecycle.get("last_lifecycle_update_at")
        or ""
    ).strip()

    return {
        "delegation_status": delegation_status,
        "validation_status": validation_status,
        "delegation_target": delegation_target,
        "handoff_summary": handoff_summary,
        "packet_ready": bool(delegation.get("packet_ready")) if delegation else packet_ready,
        "tool_resolution_mode": tool_resolution_mode,
        "tool_resolution_cost": tool_resolution_cost,
        "tool_fallback": fallback_target,
        "tool_validation_gate": str(delegation.get("tool_validation_gate") or validation_status),
        "result_status": result_status,
        "result_summary": result_summary,
        "result_logged_at": result_logged_at,
        "lifecycle_status": lifecycle_status,
    }


def _tool_research_summary(orchestrator: dict[str, Any]) -> dict[str, Any]:
    research = (orchestrator.get("current_tool_research") if isinstance(orchestrator, dict) else None) or {}
    packet = (orchestrator.get("current_packet") if isinstance(orchestrator, dict) else None) or {}
    packet_discovery = packet.get("discovery_state") if isinstance(packet.get("discovery_state"), dict) else {}
    entry = research.get("entry") if isinstance(research.get("entry"), dict) else {}
    options = entry.get("options") if isinstance(entry.get("options"), list) else []

    if not research and not packet_discovery:
        return {}

    candidate_tools = research.get("candidate_tools")
    if not isinstance(candidate_tools, list):
        candidate_tools = [
            str(option.get("name", "")).strip()
            for option in options
            if isinstance(option, dict) and str(option.get("name", "")).strip()
        ]

    return {
        "required": bool(research.get("required") or packet_discovery.get("required")),
        "status": str(research.get("status") or packet_discovery.get("status") or "unknown"),
        "reason": str(research.get("reason") or packet_discovery.get("reason") or ""),
        "cache_key": str(research.get("cache_key") or packet_discovery.get("cache_key") or ""),
        "task": str(research.get("task") or (entry.get("task_summary") if isinstance(entry, dict) else "") or ""),
        "domain": str(research.get("domain") or ""),
        "work_type": str(research.get("work_type") or ""),
        "recommended_tool": str(research.get("recommended_tool") or entry.get("recommended_tool") or ""),
        "fallback_tool": str(research.get("fallback_tool") or ""),
        "free_alternative": str(entry.get("free_alternative") or ""),
        "paid_alternative": str(entry.get("paid_alternative") or ""),
        "recommended_next_step": str(
            research.get("recommended_next_step")
            or entry.get("next_step")
            or ""
        ),
        "cost_level": str(research.get("cost_level") or ""),
        "candidate_tools": candidate_tools or [],
        "signals": research.get("signals") if isinstance(research.get("signals"), list) else [],
        "last_checked_at": str(entry.get("last_checked_at") or ""),
        "options_count": len(options),
    }


def _hermes_connector_entry(snapshot: dict[str, dict[str, Any]]) -> dict[str, Any]:
    observability = snapshot.get("observability", {})
    status_summary = observability.get("status_summary") or {}
    overall = _normalize_status(observability.get("overall") or status_summary.get("overall") or "unknown")
    updated_at = str((snapshot.get("core_state", {}) or {}).get("updated_at", ""))
    services = {
        "overall": overall,
        "risk_guard": str((snapshot.get("risk_guard", {}) or {}).get("overall_risk_level", "n/a")),
        "next_actions": "ok" if (snapshot.get("next_actions", {}) or {}).get("actions") else "missing",
        "session_closer": "ok" if snapshot.get("session_closer") else "missing",
    }
    return {
        "name": "Hermes",
        "status": overall,
        "services": services,
        "updated_at": updated_at,
        "stale_seconds": _relative_seconds(updated_at),
        "attention_needed": _status_rank(overall) >= 2,
        "summary": _best_connector_summary("Hermes", overall, services),
        "details": snapshot.get("core_state", {}) or {},
    }


def _hermes_continuity(snapshot: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    session_closer = snapshot.get("session_closer", {}) or {}
    if session_closer:
        items.append(
            {
                "heading": "Hermes — Dernière clôture de session",
                "summary": " ".join(
                    part
                    for part in [
                        str(session_closer.get("summary", "")).strip(),
                        f"Prochain pas: {session_closer.get('next_step', '')}".strip(),
                    ]
                    if part.strip()
                ).strip(),
            }
        )
    project_route = snapshot.get("project_route", {}) or {}
    if project_route:
        categories = ", ".join(project_route.get("categories", []) or [])
        items.append(
            {
                "heading": "Hermes — Routage projet",
                "summary": f"Projet: {categories or 'n/a'}. Prochain pas sûr: {project_route.get('next_safest_step', 'n/a')}",
            }
        )
    next_actions = snapshot.get("next_actions", {}) or {}
    actions = next_actions.get("actions", []) or []
    if actions:
        lead = "; ".join(str(action.get("label", "")).strip() for action in actions[:2] if str(action.get("label", "")).strip())
        items.append(
            {
                "heading": "Hermes — Prochaines actions",
                "summary": lead or "Aucune action synthétisée.",
            }
        )
    return items


def _priority_lane(
    state: dict[str, Any] | None,
    hermes: dict[str, dict[str, Any]],
    dynamic_result: dict[str, Any] | None,
    targeted_move: dict[str, Any] | None,
    live_brief: dict[str, Any] | None,
) -> dict[str, str]:
    core = hermes.get("core_state", {}) or {}
    pending = core.get("pending_validation") or (state or {}).get("pending_validation") or {}
    if pending:
        return {
            "headline": "Validation réelle en attente",
            "detail": str(pending.get("action", "Une action réelle attend une confirmation.")),
            "source": "pending_validation",
            "severity": "warning",
            "target_id": "pending-validation",
        }

    next_actions = (hermes.get("next_actions", {}) or {}).get("actions", []) or []
    if next_actions:
        lead = next_actions[0] or {}
        return {
            "headline": str(lead.get("label", "Prochaine action Hermes")),
            "detail": str(lead.get("why", "Synthèse de la prochaine action utile.")),
            "source": "hermes_next_actions",
            "severity": "ok",
            "target_id": "hermes-core",
        }

    session_closer = hermes.get("session_closer", {}) or {}
    if session_closer:
        return {
            "headline": "Reprise de continuité Hermes",
            "detail": str(session_closer.get("next_step", session_closer.get("summary", "Reprendre la continuité Hermes."))),
            "source": "session_closer",
            "severity": "info",
            "target_id": "continuity-details",
        }

    summary = str(
        (dynamic_result or {}).get("voice_summary")
        or (targeted_move or {}).get("voice_summary")
        or (live_brief or {}).get("voice_summary")
        or ""
    ).strip()
    return {
        "headline": "Relire le dernier résultat confirmé",
        "detail": summary or "Aucun résultat opérationnel récent.",
        "source": "last_operation",
        "severity": "info",
        "target_id": "yahoo-result",
    }


def _connectors_overview(connectors: list[dict[str, Any]]) -> dict[str, Any]:
    healthy: list[str] = []
    attention: list[str] = []
    offline: list[str] = []
    for connector in connectors:
        name = str(connector.get("name", "unknown"))
        status = str(connector.get("status", "unknown")).lower()
        if "ok" in status or status in {"native_html_ready"}:
            healthy.append(name)
        elif any(token in status for token in {"prepared", "warning", "degraded", "partial"}):
            attention.append(name)
        else:
            offline.append(name)
    return {
        "healthy": healthy,
        "attention": attention,
        "offline": offline,
    }


def _state_summary(state: dict[str, Any] | None, voice_cfg: dict[str, Any], hermes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    state = state or {}
    core = hermes.get("core_state", {}) or {}
    observability = hermes.get("observability", {}) or {}
    turns = state.get("turns", [])
    last_turn = turns[-1] if turns else {}
    updated_at = str(core.get("updated_at") or state.get("updated_at") or "")
    age_seconds = _relative_seconds(updated_at)
    active_until = state.get("active_until", "")
    active_dt = _parse_iso(active_until)
    active_now = bool(active_dt and (active_dt > datetime.now(active_dt.tzinfo)))
    paused = bool(state.get("paused", False))
    live_status = "paused" if paused else "active_window" if active_now else "idle"
    if age_seconds is not None and age_seconds <= 90 and not paused:
        live_status = "recently_active"
    status = _normalize_status(observability.get("overall") or (observability.get("status_summary") or {}).get("overall") or voice_cfg.get("voice_v4", {}).get("status", ""))
    return {
        "status": status,
        "live_status": live_status,
        "paused": paused,
        "active_until": active_until,
        "updated_at": updated_at,
        "age_seconds": age_seconds,
        "turn_count": len(turns),
        "last_transcription": last_turn.get("user", ""),
        "last_response": str(core.get("last_summary") or state.get("last_answer", "") or last_turn.get("assistant", "")),
        "pending_validation": core.get("pending_validation") or state.get("pending_validation"),
        "last_validated_action": state.get("last_validated_action"),
        "active_intent": str(core.get("active_intent", "")),
        "last_recommended_action": str(core.get("last_recommended_action", "")),
        "last_skill_run": core.get("last_skill_run"),
    }


def _voice_signal(state: dict[str, Any] | None, voice_cfg: dict[str, Any], general_state: dict[str, Any]) -> dict[str, Any]:
    state = state or {}
    last_turn = ((state.get("turns") or [{}])[-1]) if state.get("turns") else {}
    return {
        "status": "warning" if general_state.get("paused") else "ok",
        "live_status": general_state.get("live_status", "unknown"),
        "wake_word": voice_cfg.get("voice_v4", {}).get("wake_word", ""),
        "pending_validation": bool(general_state.get("pending_validation")),
        "last_user": str(last_turn.get("user", "")),
        "last_response": str(general_state.get("last_response", "")),
    }


def _yahoo_signal(
    targeted_move: dict[str, Any] | None,
    dynamic_candidate: dict[str, Any] | None,
    dynamic_result: dict[str, Any] | None,
) -> dict[str, Any]:
    targeted_move = targeted_move or {}
    dynamic_candidate = dynamic_candidate or {}
    dynamic_result = dynamic_result or {}
    dynamic_pending = bool(dynamic_candidate) and not bool(dynamic_result)
    last_summary = str(
        dynamic_result.get("voice_summary")
        or targeted_move.get("voice_summary")
        or dynamic_candidate.get("voice_summary")
        or ""
    )
    moved_now = dynamic_result.get("messages_moved_now")
    status = "warning" if dynamic_pending else "ok" if (targeted_move or dynamic_result) else "unknown"
    return {
        "status": status,
        "dynamic_pending": dynamic_pending,
        "last_summary": last_summary,
        "messages_moved_now": moved_now,
        "latest_action": str(dynamic_result.get("action") or targeted_move.get("action") or ""),
    }


def _hermes_signal(snapshot: dict[str, dict[str, Any]]) -> dict[str, Any]:
    core = snapshot.get("core_state", {}) or {}
    observability = snapshot.get("observability", {}) or {}
    risk_guard = snapshot.get("risk_guard", {}) or {}
    next_actions = (snapshot.get("next_actions", {}) or {}).get("actions", []) or []
    return {
        "status": _normalize_status(observability.get("overall") or (observability.get("status_summary") or {}).get("overall") or "unknown"),
        "active_intent": str(core.get("active_intent", "")),
        "pending_validation": bool(core.get("pending_validation")),
        "last_recommended_action": str(core.get("last_recommended_action", "")),
        "top_next_action": str((next_actions[0] or {}).get("label", "")) if next_actions else "",
        "risk_level": str(risk_guard.get("overall_risk_level", "unknown")),
    }


def _priority_block(hermes: dict[str, dict[str, Any]], general_state: dict[str, Any]) -> dict[str, Any]:
    next_actions = (hermes.get("next_actions", {}) or {}).get("actions", []) or []
    recommended = str((hermes.get("core_state", {}) or {}).get("last_recommended_action", "")).strip()
    primary = ""
    if next_actions:
        primary = str((next_actions[0] or {}).get("label", "")).strip()
    if not primary:
        primary = recommended
    secondary = [
        str(action.get("label", "")).strip()
        for action in next_actions[1:3]
        if str(action.get("label", "")).strip()
    ]
    if not secondary and recommended and recommended != primary:
        secondary.append(recommended)
    return {
        "primary": primary,
        "secondary": secondary,
        "pending_validation": bool(general_state.get("pending_validation")),
        "source": "hermes" if primary or secondary else "runtime_fallback",
    }


def _attention_now(
    general_state: dict[str, Any],
    connectors: list[dict[str, Any]],
    hermes_signal: dict[str, Any],
    voice_signal: dict[str, Any],
    yahoo_signal: dict[str, Any],
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    pending = general_state.get("pending_validation") or {}
    if pending:
        items.append(
            {
                "level": "warning",
                "title": "Validation requise",
                "detail": str(pending.get("action") or "Une action attend ta validation."),
            }
        )
    risk_level = hermes_signal.get("risk_level", "")
    if risk_level in {"critical", "high"}:
        items.append(
            {
                "level": "warning",
                "title": f"Risk guard Hermes : {risk_level}",
                "detail": str((general_state.get("last_recommended_action") or hermes_signal.get("top_next_action") or "Vérifier la demande en cours.")),
            }
        )
    if voice_signal.get("status") == "warning":
        items.append(
            {
                "level": "info",
                "title": "Voix en pause",
                "detail": "Le runtime voix est en pause ; certaines actions resteront locales jusqu'à reprise.",
            }
        )
    if yahoo_signal.get("dynamic_pending"):
        items.append(
            {
                "level": "info",
                "title": "Yahoo en préparation",
                "detail": yahoo_signal.get("last_summary") or "Un lot Yahoo a été préparé mais pas encore exécuté.",
            }
        )
    for connector in connectors:
        if connector.get("attention_needed"):
            items.append(
                {
                    "level": "warning" if connector.get("status") == "warning" else "error",
                    "title": f"Connecteur {connector.get('name')}",
                    "detail": str(connector.get("summary") or connector.get("status") or "à vérifier"),
                }
            )
    return items[:6]


def _recent_alerts(
    state: dict[str, Any] | None,
    actions: list[dict[str, Any]],
    required_files: dict[str, Path],
    hermes: dict[str, dict[str, Any]],
) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []
    state = state or {}
    pending = (hermes.get("core_state", {}) or {}).get("pending_validation") or state.get("pending_validation")
    if pending:
        lifecycle = str(pending.get("lifecycle_status", "") or pending.get("execution_status", ""))
        is_done = lifecycle in {"result_logged", "executed", "cancelled", "rejected"}
        if not is_done:
            awaiting_since_raw = str(pending.get("awaiting_validation_at") or pending.get("prepared_at") or "")
            awaiting_dt = _parse_iso(awaiting_since_raw)
            age_hours = (
                (datetime.now(awaiting_dt.tzinfo) - awaiting_dt).total_seconds() / 3600
                if awaiting_dt else 0
            )
            level = "error" if age_hours > 24 else "warning"
            since_str = f" depuis {awaiting_since_raw[:16].replace('T', ' ')}" if awaiting_since_raw else ""
            alerts.append(
                {
                    "level": level,
                    "title": f"Validation en attente{since_str}",
                    "detail": pending.get("action", "Une action réelle attend une validation vocale."),
                }
            )
    risk_guard = hermes.get("risk_guard", {}) or {}
    if risk_guard:
        risk_level = str(risk_guard.get("overall_risk_level", "unknown"))
        generated_at_raw = str(risk_guard.get("generated_at") or "")
        generated_dt = _parse_iso(generated_at_raw)
        age_hours = (
            (datetime.now(generated_dt.tzinfo) - generated_dt).total_seconds() / 3600
            if generated_dt else None
        )
        is_stale = age_hours is not None and age_hours > 24
        if risk_level in {"critical", "high"} and not is_stale:
            alerts.append(
                {
                    "level": "warning",
                    "title": f"Hermes risk guard : {risk_level}",
                    "detail": str(risk_guard.get("recommended_response", "Une demande récente mérite une vérification.")),
                }
            )
    active_until_raw = state.get("active_until", "")
    if active_until_raw:
        active_dt = _parse_iso(active_until_raw)
        if active_dt and active_dt < datetime.now(active_dt.tzinfo):
            age_days = (datetime.now(active_dt.tzinfo) - active_dt).days
            if age_days <= 7:
                since = active_until_raw[:16].replace("T", " ")
                alerts.append(
                    {
                        "level": "warning",
                        "title": "Session Voice expirée",
                        "detail": f"Session expirée depuis {since}. Relancer une session pour réactiver la voix.",
                    }
                )
    for label, path in required_files.items():
        if not path.exists():
            alerts.append(
                {
                    "level": "error",
                    "title": f"Fichier manquant : {label}",
                    "detail": str(path),
                }
            )
    for action in reversed(actions[-8:]):
        kind = action.get("kind", "")
        if kind in {"cancelled_action", "cancelled_dynamic_batch"}:
            alerts.append(
                {
                    "level": "info",
                    "title": "Action annulée",
                    "detail": action.get("action", kind),
                }
            )
        if kind == "validated_action" and action.get("execution_status") == "validated_but_not_executed_in_generic_voice_layer":
            alerts.append(
                {
                    "level": "warning",
                    "title": "Validation sans exécution générique",
                    "detail": action.get("action", ""),
                }
            )
    return alerts[:8]


def _load_pending_validations() -> list[dict[str, Any]]:
    """Load structured pending validations from runtime JSON."""
    raw = _load_json(HERMES_PENDING_VALIDATIONS_PATH) or {}
    items = raw.get("validations", [])
    return [v for v in items if isinstance(v, dict)]


def _obsidian_relative_path(path: Path) -> str:
    try:
        return str(path.relative_to(OBSIDIAN_ROOT))
    except ValueError:
        return str(path)


def _clean_markdown_inline(value: str) -> str:
    text = value.strip()
    text = re.sub(r"<!--.*?-->", "", text)
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"[_*#]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _stable_obsidian_item_id(source_path: str, index: int, title: str) -> str:
    digest = hashlib.sha1(f"{source_path}:{index}:{title}".encode("utf-8")).hexdigest()[:10]
    return f"obsidian-{digest}"


def _infer_project(text: str, default_project: str) -> str:
    lowered = text.lower()
    checks = (
        ("ADV", ("adv", "allo devis", "devis", "facture", "stripe", "brevo", "firestore")),
        ("Jarvis", ("jarvis", "hermès", "hermes", "ruth os", "openjarvis")),
        ("Graphify", ("graphify",)),
        ("Obsidian", ("obsidian", "vault")),
        ("Valéna", ("valéna", "valena")),
        ("Codex Ruth OS", ("codex", "agent_handoff", "claude")),
        ("PERSO", ("perso",)),
        ("Remotion", ("remotion",)),
        ("Universe.io", ("universe.io",)),
    )
    for project, keywords in checks:
        if any(keyword in lowered for keyword in keywords):
            return project
    return default_project


def _infer_category(text: str, section: str = "") -> str:
    lowered = f"{section} {text}".lower()
    if any(token in lowered for token in ("urgence", "urgent", "p1", "p2", "p3", "bloqué", "bloque")):
        return "urgency"
    if any(token in lowered for token in ("décider", "decision", "décision", "arbitrer")):
        return "decision"
    if any(token in lowered for token in ("idée", "idee", "projet en veille")):
        return "idea"
    if any(token in lowered for token in ("document", "note", "handoff", "manifest")):
        return "note"
    return "task"


def _infer_priority(text: str, section: str = "") -> str:
    lowered = f"{section} {text}".lower()
    if "non urgent" in lowered or "radar" in lowered:
        return "low"
    if any(token in lowered for token in ("🟠", "p3", "bientôt", "bientot", "medium", "moyen")):
        return "medium"
    if any(token in lowered for token in ("p2", "high", "haute", "important", "bloqué", "bloque")):
        return "high"
    if any(token in lowered for token in ("🔴", "p1", "critique")):
        return "urgent"
    if "urgent" in lowered:
        return "urgent"
    return "low"


def _infer_owner(text: str) -> str:
    lowered = text.lower()
    if "codex" in lowered:
        return "Codex"
    if "claude" in lowered:
        return "Claude"
    if "hermès" in lowered or "hermes" in lowered:
        return "Hermès"
    if "ruth" in lowered or "device" in lowered or "console" in lowered or "dashboard" in lowered:
        return "Ruth"
    return "Hermès"


def _is_actionable_section(section: str) -> bool:
    lowered = section.lower()
    return any(
        token in lowered
        for token in (
            "urgence",
            "actif maintenant",
            "à traiter",
            "a traiter",
            "en attente",
            "prochaine action",
            "prochain bloc",
            "projets en veille",
            "idées",
            "idees",
            "inbox",
        )
    )


def _item_from_obsidian_text(
    *,
    title: str,
    project: str,
    source_path: str,
    updated_at: str,
    index: int,
    action_requested: str = "",
    section: str = "",
) -> dict[str, Any] | None:
    clean_title = _clean_markdown_inline(title)
    if not clean_title or clean_title in {"-", "[ ]"}:
        return None
    action = _clean_markdown_inline(action_requested) or "Lire la note source et décider du prochain geste concret."
    context = f"{clean_title} {action} {project}"
    inferred_project = _infer_project(context, project)
    return {
        "id": _stable_obsidian_item_id(source_path, index, clean_title),
        "title": clean_title[:180],
        "project": inferred_project,
        "category": _infer_category(context, section),
        "priority": _infer_priority(context, section),
        "status": "pending",
        "source_type": "obsidian",
        "source_path": source_path,
        "action_requested": action[:240],
        "owner": _infer_owner(context),
        "created_at": updated_at,
        "updated_at": updated_at,
    }


def _parse_markdown_table_row(line: str) -> list[str]:
    return [_clean_markdown_inline(cell) for cell in line.strip().strip("|").split("|")]


def _extract_obsidian_action_items(path: Path, default_project: str) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        # Trouvé en incident réel le 2026-08-31 : fichier du vault Obsidian
        # verrouillé côté iCloud (Errno 11, "Resource deadlock avoided").
        # Une lecture échouée ici ne doit jamais faire échouer tout le
        # snapshot du cockpit ni contribuer à bloquer le serveur — ignorer
        # cette source pour ce tour, elle sera relue au prochain appel.
        logger.warning("Obsidian action item read failed (skipped): %s", path)
        return []
    source_path = _obsidian_relative_path(path)
    updated_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")
    items: list[dict[str, Any]] = []
    current_section = ""
    table_headers: list[str] = []

    for raw_index, raw_line in enumerate(content.splitlines()):
        line = raw_line.strip()
        if not line or line == "---" or line.startswith(">") or line.startswith("<!--"):
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading:
            current_section = _clean_markdown_inline(heading.group(2))
            table_headers = []
            continue
        if line.startswith("|") and line.endswith("|"):
            cells = _parse_markdown_table_row(line)
            if cells and all(re.fullmatch(r":?-{2,}:?", cell.replace(" ", "")) for cell in cells):
                continue
            lowered_cells = [cell.lower() for cell in cells]
            if any(cell in {"projet", "sujet", "prochaine action", "priorité", "priorite", "idée de base"} for cell in lowered_cells):
                table_headers = lowered_cells
                continue
            if table_headers:
                row = dict(zip(table_headers, cells))
                project = row.get("projet") or default_project
                subject = row.get("sujet") or row.get("idée de base") or row.get("idee de base") or row.get("projet") or ""
                action = row.get("prochaine action") or row.get("bloqué par") or row.get("bloque par") or row.get("source") or ""
                priority = row.get("priorité") or row.get("priorite") or current_section
                item = _item_from_obsidian_text(
                    title=subject,
                    project=project,
                    source_path=source_path,
                    updated_at=updated_at,
                    index=raw_index,
                    action_requested=action,
                    section=f"{current_section} {priority}",
                )
                if item:
                    items.append(item)
            continue

        checkbox = re.match(r"^[-*]\s+\[ \]\s+(.+)$", line)
        if checkbox:
            item = _item_from_obsidian_text(
                title=checkbox.group(1),
                project=default_project,
                source_path=source_path,
                updated_at=updated_at,
                index=raw_index,
                section=current_section,
            )
            if item:
                items.append(item)
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", line)
        if bullet and _is_actionable_section(current_section):
            text = bullet.group(1)
            item = _item_from_obsidian_text(
                title=text,
                project=default_project,
                source_path=source_path,
                updated_at=updated_at,
                index=raw_index,
                section=current_section,
            )
            if item:
                items.append(item)
            continue

        if "Prochain bloc critique" in line or "Prochaine action" in line:
            label, _, value = line.partition(":")
            item = _item_from_obsidian_text(
                title=value or line,
                project=default_project,
                source_path=source_path,
                updated_at=updated_at,
                index=raw_index,
                action_requested=label,
                section=current_section,
            )
            if item:
                items.append(item)

    return items


def _load_obsidian_action_inbox_fallback() -> dict[str, Any]:
    raw = _load_json(HERMES_OBSIDIAN_ACTION_INBOX_PATH) or {}
    items = raw.get("items", [])
    active_items = [v for v in items if isinstance(v, dict) and v.get("status") != "done"]
    if active_items:
        return {
            "items": active_items,
            "source": {
                "mode": "fallback_json",
                "label": "Fallback JSON",
                "detail": str(raw.get("source") or HERMES_OBSIDIAN_ACTION_INBOX_PATH),
                "updated_at": str(raw.get("updated_at") or ""),
                "sources": [{"path": str(HERMES_OBSIDIAN_ACTION_INBOX_PATH), "exists": HERMES_OBSIDIAN_ACTION_INBOX_PATH.exists()}],
            },
        }
    return {
        "items": [],
        "source": {
            "mode": "mock",
            "label": "Mock",
            "detail": "Aucune source Obsidian réelle ni fallback JSON exploitable.",
            "updated_at": "",
            "sources": [{"path": str(HERMES_OBSIDIAN_ACTION_INBOX_PATH), "exists": HERMES_OBSIDIAN_ACTION_INBOX_PATH.exists()}],
        },
    }


def _load_obsidian_action_inbox() -> dict[str, Any]:
    """Read a targeted Obsidian action inbox, with JSON fallback if unavailable."""
    try:
        items: list[dict[str, Any]] = []
        sources: list[dict[str, Any]] = []
        for label, path, default_project in OBSIDIAN_ACTION_SOURCE_PATHS:
            exists = path.exists()
            sources.append({"label": label, "path": _obsidian_relative_path(path), "exists": exists})
            if exists:
                items.extend(_extract_obsidian_action_items(path, default_project))
        unique_items: list[dict[str, Any]] = []
        seen: set[str] = set()
        priority_rank = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
        for item in sorted(items, key=lambda row: (priority_rank.get(str(row.get("priority")), 9), str(row.get("updated_at", ""))), reverse=False):
            key = f"{item.get('title')}::{item.get('source_path')}"
            if key in seen:
                continue
            seen.add(key)
            unique_items.append(item)
        if unique_items:
            return {
                "items": unique_items[:40],
                "source": {
                    "mode": "real",
                    "label": "Obsidian réel",
                    "detail": "Lecture ciblée de 00-URGENCES, 00-MANIFEST, ADV/Idées, JARVIS/_etat-actuel et _autres-projets.",
                    "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "sources": sources,
                },
            }
    except Exception as exc:
        logger.exception("targeted Obsidian action inbox failed")
        fallback = _load_obsidian_action_inbox_fallback()
        fallback["source"]["error"] = str(exc)
        return fallback
    return _load_obsidian_action_inbox_fallback()


def _personal_cockpit_payload() -> dict[str, Any]:
    voice_cfg = _load_toml(VOICE_CONFIG_PATH)
    state = _load_json(STATE_PATH)
    sessions = _load_jsonl_tail(SESSIONS_PATH, 12)
    actions = _load_jsonl_tail(ACTIONS_PATH, 12)
    live_brief = _load_json(LIVE_BRIEF_PATH)
    targeted_move = _load_json(TARGETED_MOVE_PATH)
    dynamic_candidate = _load_json(DYNAMIC_CANDIDATE_PATH)
    dynamic_result = _load_json(DYNAMIC_RESULT_PATH)
    handoffs = _tail_handoffs(limit=5)
    hermes = _hermes_runtime_snapshot()
    orchestrator = _orchestrator_payload(hermes.get("core_state", {}) or {})
    delegation = _delegation_summary(hermes.get("core_state", {}) or {}, orchestrator, handoffs)
    tool_research = _tool_research_summary(orchestrator)
    hermes_observability = hermes.get("observability", {}) or {}
    hermes_status_summary = hermes_observability.get("status_summary") or {}
    hermes_chat_runtime = _hermes_chat_runtime_summary()
    pending_validations = _load_pending_validations()
    obsidian_action_inbox_payload = _load_obsidian_action_inbox()
    obsidian_action_inbox = obsidian_action_inbox_payload.get("items", [])
    obsidian_action_inbox_source = obsidian_action_inbox_payload.get("source", {})

    connectors = [
        _connector_entry("Yahoo", _load_json(INTEGRATIONS_DIR / "yahoo" / "status.json")),
        _connector_entry("Google", _load_json(INTEGRATIONS_DIR / "google" / "status.json")),
        _connector_entry("Apple", _load_json(INTEGRATIONS_DIR / "apple" / "status.json")),
        _connector_entry("Graphify", _load_json(INTEGRATIONS_DIR / "graphify" / "status.json")),
        _hermes_connector_entry(hermes),
    ]
    connectors = sorted(connectors, key=_connector_rank)
    general_state = _state_summary(state, voice_cfg, hermes)
    hermes_signal = _hermes_signal(hermes)
    voice_signal = _voice_signal(state, voice_cfg, general_state)
    yahoo_signal = _yahoo_signal(targeted_move, dynamic_candidate, dynamic_result)
    priorities = _priority_block(hermes, general_state)
    attention_now = _attention_now(general_state, connectors, hermes_signal, voice_signal, yahoo_signal)

    required_files = {
        "v4_state": STATE_PATH,
        "v4_sessions": SESSIONS_PATH,
        "v4_actions": ACTIONS_PATH,
        "hermes_core_state": HERMES_CORE_STATE_PATH,
        "hermes_observability": HERMES_OBSERVABILITY_PATH,
    }

    history = [
        {
            "timestamp": item.get("timestamp", ""),
            "intent": item.get("intent", ""),
            "user": item.get("user", ""),
            "assistant": item.get("assistant", ""),
        }
        for item in sessions[-8:]
    ]

    return {
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "personal_root": str(PERSONAL_ROOT),
            "voice_runtime": str(VOICE_DIR),
        },
        "general_state": general_state,
        "priorities": priorities,
        "attention_now": attention_now,
        "signals": {
            "hermes": hermes_signal,
            "voice": voice_signal,
            "yahoo": yahoo_signal,
        },
        "voice_live": {
            "config_status": voice_cfg.get("voice_v4", {}).get("status", ""),
            "wake_word": voice_cfg.get("voice_v4", {}).get("wake_word", ""),
            "vad": voice_cfg.get("voice_v4", {}).get("vad", ""),
            "stt": voice_cfg.get("voice_v4", {}).get("stt", ""),
            "tts": voice_cfg.get("voice_v4", {}).get("tts", ""),
            "commands": voice_cfg.get("voice_v4", {}).get("commands", []),
            "last_updated_at": (state or {}).get("updated_at", ""),
        },
        "latest_transcription": (state or {}).get("turns", [{}])[-1].get("user", "") if (state or {}).get("turns") else "",
        "latest_response": str((hermes.get("core_state", {}) or {}).get("last_summary") or (state or {}).get("last_answer", "")),
        "pending_validation": (hermes.get("core_state", {}) or {}).get("pending_validation") or (state or {}).get("pending_validation"),
        "pending_validations": pending_validations,
        "pending_validations_count": len([v for v in pending_validations if v.get("status") != "done"]),
        "obsidian_action_inbox": obsidian_action_inbox,
        "obsidian_action_inbox_count": len(obsidian_action_inbox),
        "obsidian_action_inbox_source": obsidian_action_inbox_source,
        "last_live_brief": live_brief,
        "yahoo_targeted_move": targeted_move,
        "yahoo_dynamic_candidate": dynamic_candidate,
        "yahoo_dynamic_result": dynamic_result,
        "session_history": history,
        "recent_actions": actions[-8:],
        "connectors": connectors,
        "connectors_overview": _connectors_overview(connectors),
        "alerts": _recent_alerts(state, actions, required_files, hermes),
        "continuity": _hermes_continuity(hermes) + handoffs,
        "priority_lane": _priority_lane(state, hermes, dynamic_result, targeted_move, live_brief),
        "hermes": {
            "overall": str(hermes_observability.get("overall") or hermes_status_summary.get("overall") or "unknown"),
            "active_intent": str((hermes.get("core_state", {}) or {}).get("active_intent", "")),
            "last_summary": str((hermes.get("core_state", {}) or {}).get("last_summary", "")),
            "last_recommended_action": str((hermes.get("core_state", {}) or {}).get("last_recommended_action", "")),
            "last_skill_run": (hermes.get("core_state", {}) or {}).get("last_skill_run"),
            "next_actions": (hermes.get("next_actions", {}) or {}).get("actions", []),
            "risk_guard": hermes.get("risk_guard", {}) or {},
            "session_closer": hermes.get("session_closer", {}) or {},
            "project_route": hermes.get("project_route", {}) or {},
            "orchestrator": orchestrator,
            "delegation": delegation,
            "tool_research": tool_research,
            "chat_runtime": hermes_chat_runtime,
            "status_summary": hermes_status_summary,
            "priority_summary": priorities,
            "capabilities": hermes.get("capabilities", {}) or {},
        },
        "file_health": {
            label: {
                "exists": path.exists(),
                "path": str(path),
                "modified_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds") if path.exists() else "",
            }
            for label, path in {
                "v4_state": STATE_PATH,
                "v4_sessions": SESSIONS_PATH,
                "v4_action_queue": ACTIONS_PATH,
                "voice_live_brief": LIVE_BRIEF_PATH,
                "yahoo_targeted_move": TARGETED_MOVE_PATH,
                "yahoo_dynamic_candidate": DYNAMIC_CANDIDATE_PATH,
                "yahoo_dynamic_result": DYNAMIC_RESULT_PATH,
                "session_handoffs": HANDOFFS_PATH,
                "hermes_core_state": HERMES_CORE_STATE_PATH,
                "hermes_observability": HERMES_OBSERVABILITY_PATH,
                "hermes_next_actions": HERMES_NEXT_ACTIONS_PATH,
                "hermes_risk_guard": HERMES_RISK_GUARD_PATH,
                "hermes_session_closer": HERMES_SESSION_CLOSER_PATH,
                "hermes_current_request": HERMES_CURRENT_REQUEST_PATH,
                "hermes_current_packet": HERMES_CURRENT_PACKET_PATH,
                "hermes_current_tool_decision": HERMES_CURRENT_TOOL_DECISION_PATH,
                "hermes_current_delegation": HERMES_CURRENT_DELEGATION_PATH,
                "hermes_current_tool_research": HERMES_CURRENT_TOOL_RESEARCH_PATH,
                "hermes_current_codex_handoff": HERMES_CURRENT_CODEX_HANDOFF_PATH,
                "hermes_recent_trace_json": HERMES_RECENT_TRACE_JSON_PATH,
                "hermes_recent_trace_jsonl": HERMES_RECENT_TRACE_JSONL_PATH,
            }.items()
        },
    }


def _parse_ideas_inbox() -> list[dict[str, Any]]:
    """Parse ideas-inbox.md and return structured idea list."""
    if not OBSIDIAN_IDEAS_PATH.exists():
        return []
    try:
        content = OBSIDIAN_IDEAS_PATH.read_text(encoding="utf-8")
    except OSError:
        # Même incident que _extract_obsidian_action_items (2026-08-31) :
        # fichier iCloud verrouillé — ne jamais laisser ça faire échouer
        # le snapshot entier.
        logger.warning("Obsidian ideas inbox read failed (skipped)")
        return []
    ideas: list[dict[str, Any]] = []
    current_section: str | None = None
    idx = 0
    for line in content.splitlines():
        if line.startswith("## "):
            current_section = line[3:].strip()
        elif current_section and (line.startswith("- [ ] ") or line.startswith("- [x] ")):
            done = line.startswith("- [x] ")
            text = line[6:].strip()
            if not text:
                continue
            tag = _SECTION_TO_TAG.get(current_section, "Business")
            ideas.append({
                "id": f"obs_{abs(hash(text)) % 10 ** 8}_{idx}",
                "text": text,
                "tag": tag,
                "done": done,
                "section": current_section,
                "obsidian_path": "_autres-projets/ideas-inbox.md",
            })
            idx += 1
    return ideas


@router.get("")
async def personal_cockpit_snapshot():
    """Return a local cockpit snapshot sourced from jarvis-personal runtime."""
    try:
        return _personal_cockpit_payload()
    except Exception as exc:  # pragma: no cover - fallback hardening
        logger.exception("personal cockpit snapshot failed")
        return _empty_snapshot(str(exc))


@router.get("/ideas")
async def list_ideas():
    """Return ideas from the Obsidian ideas-inbox.md."""
    try:
        return _parse_ideas_inbox()
    except Exception:
        logger.exception("list_ideas failed")
        return []


async def _fetch_stripe_data(stripe_key: str) -> dict[str, Any]:
    """Call Stripe API for MRR and CA mensuel. Returns empty dict on any failure."""
    headers = {"Authorization": f"Bearer {stripe_key}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            subs_resp = await client.get(
                "https://api.stripe.com/v1/subscriptions",
                headers=headers,
                params={"status": "active", "limit": "100"},
            )
            if subs_resp.status_code != 200:
                return {}
            subs = subs_resp.json().get("data", [])
            mrr = 0.0
            for sub in subs:
                plan = sub.get("plan") or {}
                if not plan:
                    items = (sub.get("items") or {}).get("data", [{}])
                    plan = items[0].get("plan", {}) if items else {}
                amount_cents = int(plan.get("amount", 0) or 0)
                interval = plan.get("interval", "month")
                currency = (plan.get("currency") or "eur").lower()
                if currency == "eur":
                    mrr += amount_cents / 100 if interval == "month" else amount_cents / 1200

            now = datetime.now(timezone.utc)
            start_month_ts = int(datetime(now.year, now.month, 1, tzinfo=timezone.utc).timestamp())
            charges_resp = await client.get(
                "https://api.stripe.com/v1/charges",
                headers=headers,
                params={"limit": "100", "created[gte]": str(start_month_ts), "paid": "true"},
            )
            ca_mensuel = 0.0
            if charges_resp.status_code == 200:
                for charge in charges_resp.json().get("data", []):
                    if (
                        (charge.get("currency") or "").lower() == "eur"
                        and not charge.get("refunded")
                        and not charge.get("failure_code")
                    ):
                        ca_mensuel += int(charge.get("amount", 0) or 0) / 100

            return {
                "mrr": round(mrr, 2),
                "arr": round(mrr * 12, 2),
                "ca_mensuel": round(ca_mensuel, 2),
                "stripe_actifs": len(subs),
            }
    except Exception:
        logger.exception("Stripe API call failed")
        return {}


def _adv_snapshot_age() -> float | None:
    if not ADV_SNAPSHOT_PATH.exists():
        return None
    mtime = ADV_SNAPSHOT_PATH.stat().st_mtime
    return (datetime.now(timezone.utc) - datetime.fromtimestamp(mtime, tz=timezone.utc)).total_seconds()


@router.get("/adv-snapshot")
async def get_adv_snapshot():
    """Return ADV business snapshot — pulls from n8n webhook when stale."""
    age = _adv_snapshot_age()
    if ADV_SNAPSHOT_PATH.exists() and age is not None and age < ADV_SNAPSHOT_TTL:
        data = json.loads(ADV_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        data["_age_seconds"] = round(age)
        data["_stale"] = False
        return data
    keys = _load_cloud_keys()
    webhook_url = keys.get("N8N_ADV_SNAPSHOT_WEBHOOK", "")
    if webhook_url:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(webhook_url)
                if resp.status_code == 200:
                    payload = resp.json()
                    if isinstance(payload, list) and payload:
                        payload = payload[0]
                    # Merge Stripe revenue when key is configured
                    stripe_key = keys.get("STRIPE_SECRET_KEY", "").strip()
                    if stripe_key:
                        stripe_data = await _fetch_stripe_data(stripe_key)
                        if stripe_data:
                            payload.setdefault("business", {}).update({
                                "mrr": stripe_data["mrr"],
                                "arr": stripe_data["arr"],
                                "ca_mensuel": stripe_data["ca_mensuel"],
                            })
                            payload.setdefault("sante_technique", {}).setdefault("services", {})["stripe"] = "ok"
                            objectif_mrr = int(
                                (payload.get("objectifs_ruth") or {}).get("objectif_mrr_1") or 1000
                            )
                            payload.setdefault("objectifs_ruth", {}).update({
                                "mrr_actuel": stripe_data["mrr"],
                                "progression_pct": round(
                                    min(100.0, stripe_data["mrr"] / max(objectif_mrr, 1) * 100), 2
                                ),
                            })
                    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
                    ADV_SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
                    ADV_SNAPSHOT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                    payload["_age_seconds"] = 0
                    payload["_stale"] = False
                    return payload
        except Exception:
            logger.exception("Failed to fetch ADV snapshot from n8n")
    if ADV_SNAPSHOT_PATH.exists():
        data = json.loads(ADV_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        data["_age_seconds"] = round(age) if age is not None else None
        data["_stale"] = True
        return data
    return {"_empty": True}


@router.get("/hermes-trace")
async def get_hermes_trace():
    """Return the latest Hermès recent_trace entries."""
    trace = _load_recent_trace()
    file_mtime = ""
    if HERMES_RECENT_TRACE_JSON_PATH.exists():
        mtime = HERMES_RECENT_TRACE_JSON_PATH.stat().st_mtime
        file_mtime = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
    return {"entries": trace, "updated_at": file_mtime, "count": len(trace)}


@router.post("/adv-snapshot")
async def receive_adv_snapshot(request: Request):
    """Accept a pushed ADV snapshot (alternative to pull model)."""
    try:
        payload = await request.json()
        if not payload.get("generated_at"):
            payload["generated_at"] = datetime.now(timezone.utc).isoformat()
        ADV_SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        ADV_SNAPSHOT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True}
    except Exception:
        logger.exception("receive_adv_snapshot failed")
        return {"ok": False}


# Blocs A-Z par projet (2026-08-29, demande explicite de Ruth) — chaque projet
# suivi par blocs (méthode CODEX_RUTH_OS/METHODE_PILOTAGE_PAR_BLOCS.md) a son
# propre PROJECT_BUILD_MAP.md à la racine de son repo. Seuls les projets listés
# ici en ont un aujourd'hui — ne pas en inventer pour les autres, l'écran doit
# afficher honnêtement "pas encore suivi par blocs" plutôt que fabriquer des
# blocs. Mettre à jour cette table quand un nouveau projet adopte la méthode.
# Blocs A-Z réels par projet — logique déplacée dans project_blocks.py
# (module partagé à la racine de ~/.openjarvis/jarvis-personal/, importable
# aussi par hermes_core) le 2026-08-30, étape 1 du plan de finition GO LIVE
# Hermès (CODEX_RUTH_OS/CORE/HANDOFFS/2026-08-30_CLAUDE_go-live-hermes-plan-finition.md).
# Ne pas dupliquer les parseurs ici — une seule source de vérité pour que
# RuthOS et l'orchestrateur Hermès lisent exactement la même chose.
def _project_blocks_module():
    if str(PERSONAL_ROOT) not in os.sys.path:
        os.sys.path.insert(0, str(PERSONAL_ROOT))
    import project_blocks

    return project_blocks


def _published_project_states() -> dict[str, Any]:
    """Return a safe, read-only projection of published RuthOS project snapshots.

    The snapshots remain owned by their source projects.  This endpoint never
    regenerates, modifies, or guesses project data.  Invalid or temporarily
    unreadable files are reported as warnings and are deliberately excluded.
    """
    projects: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        paths = sorted(PROJECT_STATE_SNAPSHOTS_DIR.glob("*.snapshot.json"))
    except OSError:
        logger.warning("Project State directory read failed (skipped)")
        return {"projects": [], "warnings": ["Snapshots Project State indisponibles."], "source": "project-state"}

    for path in paths:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("Invalid Project State snapshot skipped: %s", path.name)
            warnings.append(f"Snapshot ignoré car invalide : {path.name}")
            continue

        if not isinstance(raw, dict) or not _PROJECT_STATE_REQUIRED_FIELDS.issubset(raw):
            logger.warning("Incomplete Project State snapshot skipped: %s", path.name)
            warnings.append(f"Snapshot ignoré car incomplet : {path.name}")
            continue

        project = raw.get("project")
        freshness = raw.get("freshness")
        state = raw.get("state")
        if not all(isinstance(item, dict) for item in (project, freshness, state)):
            logger.warning("Malformed Project State snapshot skipped: %s", path.name)
            warnings.append(f"Snapshot ignoré car malformé : {path.name}")
            continue
        project_id = project.get("id")
        project_name = project.get("name")
        if not isinstance(project_id, str) or not project_id or not isinstance(project_name, str) or not project_name:
            logger.warning("Unnamed Project State snapshot skipped: %s", path.name)
            warnings.append(f"Snapshot ignoré sans projet identifiable : {path.name}")
            continue

        # No absolute local paths, source file names, or provenance details are
        # needed by the cockpit.  Keep the UI projection deliberately small.
        projects.append({
            "schema_version": raw["schema_version"],
            "project": {"id": project_id, "name": project_name},
            "freshness": {
                "status": freshness.get("status"),
                "observed_at": freshness.get("observed_at"),
                "stale_after_days": freshness.get("stale_after_days"),
            },
            "state": {
                "lifecycle": state.get("lifecycle"),
                "summary": state.get("summary"),
                "active_block": state.get("active_block"),
                "next_action": state.get("next_action"),
                "decisions_required": state.get("decisions_required", []),
                "blockers": state.get("blockers", []),
                "risks": state.get("risks", []),
            },
        })

    return {"projects": projects, "warnings": warnings, "source": "project-state"}


@router.get("/project-blocks/{project_id}")
async def get_project_blocks(project_id: str):
    """Blocs A-Z réels d'un projet, lus en direct depuis son fichier de suivi.
    Pas de cache : le fichier peut être mis à jour par Hermès/Claude/Codex entre
    deux ouvertures de l'écran."""
    try:
        return _project_blocks_module().get_project_blocks(project_id)
    except Exception:
        logger.exception("get_project_blocks failed for %s", project_id)
        return {"project_id": project_id, "tracked": False, "source_path": None, "blocks": []}


@router.get("/project-state")
async def get_project_state():
    """Expose only explicitly published Project State snapshots, read-only."""
    return _published_project_states()


def _safe_read_text(path: Path) -> str | None:
    """Lecture protégée d'un fichier du vault Obsidian (iCloud) — un verrou
    iCloud ponctuel (OSError: Resource deadlock avoided, Errno 11, incident
    réel du 2026-08-31) ne doit jamais faire échouer tout un endpoint ni
    contribuer à bloquer le serveur. None si illisible pour ce tour."""
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        logger.warning("Obsidian file read failed (skipped): %s", path)
        return None


@router.get("/adv-obsidian")
async def get_adv_obsidian():
    """Return Obsidian context excerpts for the ADV cockpit (all tabs)."""
    result: dict[str, Any] = {}
    simple_paths = [
        ("adv_state", OBSIDIAN_ROOT / "ADV" / "_etat-actuel.md", 2000),
        ("codex_current_state", OBSIDIAN_ROOT / "CODEX_RUTH_OS" / "01_CURRENT_STATE.md", 800),
        ("juridique", OBSIDIAN_ROOT / "ADV" / "Décisions" / "legal-adv.md", 3000),
    ]
    for key, path, max_len in simple_paths:
        if path.exists():
            content = _safe_read_text(path)
            if content is None:
                continue
            result[key] = content[:max_len]
            result[key + "_path"] = str(path)
    # Codex update log — last ~1 500 chars (most recent entries)
    codex_log_path = OBSIDIAN_ROOT / "CODEX_RUTH_OS" / "07_LOG" / "UPDATE_LOG.md"
    if codex_log_path.exists():
        content = _safe_read_text(codex_log_path)
        if content is not None:
            result["codex_log"] = content[-1800:] if len(content) > 1800 else content
            result["codex_log_path"] = str(codex_log_path)
    return result


@router.patch("/ideas")
async def toggle_idea(body: IdeaToggleRequest):
    """Mark an idea done or undone in Obsidian ideas-inbox.md."""
    try:
        content = OBSIDIAN_IDEAS_PATH.read_text(encoding="utf-8")
        lines = content.splitlines()
        old_prefix = "- [x] " if not body.done else "- [ ] "
        new_prefix = "- [ ] " if not body.done else "- [x] "
        changed = False
        for i, line in enumerate(lines):
            if line.startswith(old_prefix) and line[6:].strip() == body.text:
                lines[i] = new_prefix + body.text
                changed = True
                break
        if changed:
            OBSIDIAN_IDEAS_PATH.write_text("\n".join(lines), encoding="utf-8")
        return {"ok": changed}
    except Exception:
        logger.exception("toggle_idea failed")
        return {"ok": False}


@router.post("/ideas")
async def capture_idea(body: IdeaCaptureRequest):
    """Append a new idea to the Obsidian ideas-inbox.md."""
    section = _TAG_TO_SECTION.get(body.tag, "Idées business / service")
    today = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        content = OBSIDIAN_IDEAS_PATH.read_text(encoding="utf-8") if OBSIDIAN_IDEAS_PATH.exists() else ""
        lines = content.splitlines()
        section_header = f"## {section}"
        insert_idx: int | None = None
        for i, line in enumerate(lines):
            if line.strip() == section_header:
                j = i + 1
                while j < len(lines) and (lines[j].strip() == "" or lines[j].strip().startswith("_")):
                    j += 1
                insert_idx = j
                break
        if insert_idx is None:
            lines += ["", section_header, "", f"- [ ] {body.text}"]
        else:
            lines.insert(insert_idx, f"- [ ] {body.text}")
        new_content = "\n".join(lines)
        new_content = re.sub(r"^mise_a_jour: .+$", f"mise_a_jour: {today}", new_content, flags=re.MULTILINE)
        new_content = re.sub(
            r"_Dernière mise à jour : .+_",
            f"_Dernière mise à jour : {today}_",
            new_content,
        )
        OBSIDIAN_IDEAS_PATH.write_text(new_content, encoding="utf-8")
        return {"obsidian_path": "_autres-projets/ideas-inbox.md", "section": section, "ok": True}
    except Exception:
        logger.exception("capture_idea failed")
        return {"obsidian_path": "", "section": section, "ok": False}


@hermes_chat_router.post("/alerts/action")
@router.post("/alerts/action")
async def hermes_alert_action(request_body: HermesAlertActionRequest):
    """Record cockpit alert actions without triggering external side effects."""
    action_messages = {
        "fix": "Action 'Corriger' enregistrée.",
        "create_task": "Action 'Créer tâche' enregistrée.",
        "ignore": "Action 'Ignorer' enregistrée.",
    }
    payload = {
        "kind": "cockpit_alert_action",
        "source": request_body.source,
        "action": request_body.action,
        "alert_title": request_body.alert_title.strip(),
        "alert_detail": request_body.alert_detail.strip(),
        "alert_level": request_body.alert_level.strip().lower() or "warning",
        "recorded_at": datetime.now().isoformat(timespec="seconds"),
    }
    _append_jsonl(HERMES_ALERT_ACTIONS_LOG_PATH, payload)
    return {
        "ok": True,
        "connected": True,
        "executed": False,
        "status": "recorded",
        "action": request_body.action,
        "message": action_messages.get(request_body.action, "Action alerte enregistrée."),
        "recorded_at": payload["recorded_at"],
    }


@hermes_chat_router.get("/codex-handoff")
@router.get("/hermes/codex-handoff")
async def hermes_codex_handoff_state(full: bool = False):
    existing = _load_json(HERMES_CURRENT_CODEX_HANDOFF_PATH) or {}
    compact_payload = _build_codex_handoff_payload(existing, include_full=False)
    _write_json_atomic(HERMES_CURRENT_CODEX_HANDOFF_PATH, compact_payload)
    if full:
        return {"ok": True, "handoff": _build_codex_handoff_payload(compact_payload, include_full=True)}
    return {"ok": True, "handoff": compact_payload}


@hermes_chat_router.post("/codex-handoff/ack")
@router.post("/hermes/codex-handoff/ack")
async def hermes_codex_handoff_ack(request_body: HermesCodexHandoffAckRequest):
    existing = _load_json(HERMES_CURRENT_CODEX_HANDOFF_PATH) or {}
    handoff = _build_codex_handoff_payload(existing, include_full=False)
    if request_body.handoff_id.strip() and request_body.handoff_id.strip() != str(handoff.get("handoff_id", "")):
        raise HTTPException(status_code=409, detail="handoff_id différent du handoff Codex actif.")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    summary = request_body.summary.strip()
    result_summary = request_body.result_summary.strip()
    warning = ""

    if request_body.status == "received":
        summary = summary or "Codex a accusé réception du handoff."
    elif request_body.status == "running":
        summary = summary or "Codex exécute le handoff."
    elif request_body.status == "done":
        result_summary = result_summary or summary or "Codex a terminé le handoff."
        summary = summary or result_summary
    elif request_body.status == "failed":
        result_summary = result_summary or summary or "Codex a échoué sur le handoff."
        summary = summary or result_summary

    handoff.update(
        {
            "status": request_body.status,
            "summary": summary,
            "updated_at": now,
            "last_source": request_body.source,
        }
    )
    if request_body.status in {"done", "failed"}:
        handoff["completed_at"] = now
        handoff["result_summary"] = result_summary
    else:
        handoff["completed_at"] = ""
        handoff["result_summary"] = ""

    _append_jsonl(
        HERMES_CODEX_HANDOFF_EVENTS_LOG_PATH,
        {
            "handoff_id": handoff.get("handoff_id", ""),
            "status": request_body.status,
            "summary": summary,
            "result_summary": result_summary,
            "source": request_body.source,
            "recorded_at": now,
        },
    )

    if request_body.status in {"received", "running"}:
        synced = _sync_runtime_delegation_progress(
            status=f"handoff_{request_body.status}",
            summary=summary,
            source=request_body.source,
        )
        if not synced:
            active_target = _active_runtime_delegation_target() or "unknown"
            warning = (
                "Handoff Codex journalisé, mais la délégation active n'est pas codex_executor "
                f"(target actif: {active_target})."
            )
    else:
        execution_status = "executed" if request_body.status == "done" else "failed"
        active_target = _active_runtime_delegation_target()
        if active_target and active_target != "codex_executor":
            warning = (
                "Résultat Codex journalisé sans muter la délégation active "
                f"(target actif: {active_target})."
            )
            _append_recent_trace_event(
                event_type="codex_handoff_result",
                status=execution_status,
                tool="codex_executor",
                notes=result_summary,
            )
        else:
            try:
                record_delegation_result_via_core = _hermes_core_delegation_api()
                record_delegation_result_via_core(
                    PERSONAL_ROOT,
                    execution_status=execution_status,
                    result_summary=result_summary,
                    tool_id="codex_executor",
                )
                _append_recent_trace_event(
                    event_type="codex_handoff_result",
                    status=execution_status,
                    tool="codex_executor",
                    notes=result_summary,
                )
            except Exception as exc:
                warning = f"Fallback runtime utilisé pour statut Codex {request_body.status}: {exc}"
                synced = _sync_runtime_delegation_progress(
                    status="result_logged" if request_body.status == "done" else "failed",
                    summary=result_summary,
                    source=request_body.source,
                )
                if not synced and not warning:
                    warning = "Handoff Codex finalisé mais délégation active hors codex_executor."

    _write_json_atomic(HERMES_CURRENT_CODEX_HANDOFF_PATH, handoff)
    return {
        "ok": True,
        "handoff": handoff,
        "warning": warning,
    }


# Missions proposées vs approbation d'exécution — étape 5 du plan de
# finition GO LIVE Hermès, décision Ruth 2026-08-30 (Option B) : "on ne
# touche pas à la garantie qui protège — parler à Hermès ne doit jamais
# créer automatiquement une approbation, même pour une mission sensible."
# Deux espaces distincts :
# - GET /hermes/proposed-mission : lecture seule, ce qu'Hermès a compris/
#   préparé (project_context, agent recommandé) — jamais de validation créée.
# - POST /hermes/prepare-execution : seul chemin qui crée une vraie
#   validation (via request_validation_via_core, la policy VERT/ORANGE/ROUGE
#   de Codex), et seulement si Ruth clique explicitement "Préparer
#   l'exécution". Le bouton "Approuver" existant (_current_hermes_validation)
#   la lit ensuite sans rien changer côté lui.
CURRENT_MISSION_PATH = HERMES_DIR / "current_mission.json"
CURRENT_AGENT_ROUTE_PATH = HERMES_DIR / "current_agent_route.json"


# Une mission proposée non traitée après ce délai n'est plus affichée comme
# "à l'instant" — trouvaille Codex du 2026-08-31 : Ruth a vu une tentative
# bloquée par quota datant de la veille présentée sans aucune indication
# d'ancienneté, confondable avec l'état réel du projet après coup.
PROPOSED_MISSION_STALE_HOURS = 6


@router.get("/hermes/proposed-mission")
async def get_proposed_mission():
    """Ce qu'Hermès a compris et préparé pour la dernière demande — lecture
    seule, ne crée jamais de validation. C'est la garantie de l'étape 3
    (observation_only) qui reste intacte : parler à Hermès ne déclenche
    jamais d'approbation toute seule."""
    mission = _load_json(CURRENT_MISSION_PATH) or {}
    route = _load_json(CURRENT_AGENT_ROUTE_PATH) or {}
    core_state = _load_json(HERMES_CORE_STATE_PATH) or {}
    validation_state = _load_json(HERMES_VALIDATION_STATE_PATH) or {}
    mission_history = core_state.get("mission_history") if isinstance(core_state.get("mission_history"), list) else []
    # Expose only the UI-safe mission proof. The current mission remains the
    # active pointer; history is intentionally distinct so a new observation
    # cannot visually erase an earlier result.
    mission_history = [entry for entry in mission_history if isinstance(entry, dict)][-12:]
    last_resolved = validation_state.get("last_resolved") if isinstance(validation_state.get("last_resolved"), dict) else {}
    # Une validation approuvée n'est pas encore une exécution. Ne jamais la
    # présenter comme « Dernière exécution réelle » pendant que l'agent tourne
    # (sinon G affiche à tort « agent inconnu » avec le texte de validation).
    # Mission history is the authoritative per-request trail. `last_resolved`
    # is a legacy singleton and can lack the request id/agent after an async
    # execution, which must not disconnect a result from its mission in G.
    completed_history = next(
        (
            entry
            for entry in reversed(mission_history)
            if entry.get("execution_status") in {"executed", "result_logged"}
            and entry.get("result_summary")
        ),
        None,
    )
    if completed_history:
        last_execution = {
            "mission_request_id": completed_history.get("request_id"),
            "execution_status": completed_history.get("execution_status"),
            "result_summary": completed_history.get("result_summary"),
            "executed_at": completed_history.get("executed_at"),
            "resolved_at": completed_history.get("resolved_at"),
            "requested_agent": completed_history.get("requested_agent"),
            "executed_by": completed_history.get("executed_by"),
            "fallback_used": completed_history.get("fallback_used"),
        }
        last_execution = {key: value for key, value in last_execution.items() if value not in (None, "")}
    else:
        last_execution = (
            {
                key: last_resolved.get(key)
                for key in ("mission_request_id", "execution_status", "result_summary", "executed_at", "resolved_at", "requested_agent", "executed_by", "fallback_used")
                if last_resolved.get(key) not in (None, "")
            }
            if last_resolved.get("execution_status") in {"executed", "result_logged"}
            else {}
        )
    # Le texte libre de l'agent n'est pas le registre de décisions de Ruth.
    # On le conserve pour traçabilité mais marque toute affirmation de
    # validation humaine, afin que l'UI la présente comme non confirmée.
    if last_execution:
        last_execution["contains_unverified_ruth_decision_claim"] = bool(
            _UNVERIFIED_RUTH_DECISION_CLAIM_RE.search(str(last_execution.get("result_summary") or ""))
        )
    # `current_mission.json` is an execution pointer, not necessarily an open
    # proposal. Once this exact request has a recorded result, leaving it in
    # the proposal card makes G claim both “nothing launched” and “executed”.
    # Keep the immutable result visible, but do not offer the same mission a
    # second time.
    if (
        mission
        and str(mission.get("request_id") or "")
        and str(mission.get("request_id")) == str(last_execution.get("mission_request_id") or "")
        and last_execution.get("execution_status") in {"executed", "result_logged"}
    ):
        return {"has_mission": False, "mission": None, "route": None, "mission_history": mission_history, "last_execution": last_execution or None}
    if not mission or not CURRENT_MISSION_PATH.exists():
        return {"has_mission": False, "mission": None, "route": None, "mission_history": mission_history, "last_execution": last_execution or None}
    generated_at = datetime.fromtimestamp(CURRENT_MISSION_PATH.stat().st_mtime).isoformat(timespec="seconds")
    age_hours = (datetime.now() - datetime.fromtimestamp(CURRENT_MISSION_PATH.stat().st_mtime)).total_seconds() / 3600
    if age_hours > PROPOSED_MISSION_STALE_HOURS:
        return {"has_mission": False, "mission": None, "route": None, "expired_at": generated_at, "mission_history": mission_history, "last_execution": last_execution or None}
    return {"has_mission": True, "mission": mission, "route": route, "generated_at": generated_at, "mission_history": mission_history, "last_execution": last_execution or None}


# Panneau "Agents / Système" (demande Ruth 2026-08-31, fusion Jarvis G +
# ancien Jarvis) : petit espace de contrôle secondaire, pas sur la Home —
# disponibilité réelle Claude/Codex, agent en cours, repli éventuel, coût,
# missions en cours, erreurs. Lecture seule, aucune action.
@router.get("/hermes/agents-status")
async def get_agents_status():
    agents: list[dict[str, Any]] = []
    doctor_ok = False
    try:
        completed = subprocess.run(
            ["python3", str(RUTH_OS_BRIDGE_DIR / "route_agent.py"), "--doctor"],
            cwd=RUTH_OS_BRIDGE_DIR, text=True, capture_output=True, timeout=10, check=False,
        )
        for line in completed.stdout.splitlines():
            match = re.match(r"^agent\.(\S+) provider=(\S+) status=(available|unavailable)$", line.strip())
            if match:
                agents.append({
                    "agent": match.group(1),
                    "provider": match.group(2),
                    "available": match.group(3) == "available",
                })
        doctor_ok = "ROUTER_DOCTOR_OK" in completed.stdout
    except Exception:
        logger.exception("route_agent.py --doctor failed")

    delegation = _load_json(HERMES_DIR / "current_delegation.json") or {}
    mission = _load_json(CURRENT_MISSION_PATH) or {}
    execution = _current_hermes_execution()
    mission_in_progress = bool(mission) and mission.get("status") == "mission_ready_not_executed"

    return {
        "doctor_ok": doctor_ok,
        "agents": agents,
        "current_agent": {
            "requested_agent": delegation.get("requested_agent") or delegation.get("delegation_target") or "",
            "executed_by": delegation.get("executed_by") or "",
            "fallback_used": bool(delegation.get("fallback_used", False)),
            "delegation_status": delegation.get("delegation_status") or "",
            "session_log_available": (PERSONAL_ROOT / "runtime" / "hermes" / "sessions" / "latest.log").exists(),
        },
        "mission_in_progress": {
            "active": mission_in_progress,
            "request_summary": mission.get("request_summary") if mission_in_progress else None,
            "project_id": (mission.get("project_context") or {}).get("project_id") if mission_in_progress else None,
        },
        "execution": {
            "status": execution.get("status") or "idle",
            "mission_request_id": execution.get("mission_request_id") or None,
            "summary": execution.get("summary") or None,
            "error": execution.get("error") or None,
            "updated_at": execution.get("updated_at") or None,
        },
    }


# Phase 3 — Ruth (2026-08-31) : "vérifier facilement que la mission a bien
# été envoyée dans la vraie session/terminal de l'agent concerné." Lecture
# seule du transcript brut complet (non tronqué) de la dernière exécution
# réelle, écrit par agent_bridge.py. Un seul fichier, écrasé à chaque
# exécution — cohérent avec "une mission à la fois" partout ailleurs.
_SESSION_LOG_MARKER = "=== Session Hermès — "


@router.get("/hermes/session-log")
async def get_session_log():
    log_path = PERSONAL_ROOT / "runtime" / "hermes" / "sessions" / "latest.log"
    if not log_path.exists():
        return {"available": False, "content": None}
    content = _safe_read_text(log_path)
    if content is None:
        return {"available": False, "content": None}
    # Défense en profondeur : si plusieurs blocs de session finissent dans
    # le même fichier (une seule écriture attendue, mais mieux vaut ne
    # jamais montrer un transcript confus à Ruth) — ne montrer que le
    # dernier bloc réel.
    last_marker = content.rfind(_SESSION_LOG_MARKER)
    if last_marker > 0:
        content = content[last_marker:]
    return {"available": True, "content": content}


# Aperçu du prompt réel — Ruth (2026-08-31) : "me montrer ce prompt avant
# envoi". Reflète exactement le gabarit construit par
# CORE/bridge/agents.d/{codex,claude}.sh — dupliqué ici volontairement pour
# un aperçu en lecture seule, sans jamais influencer l'envoi réel (les .sh
# restent la seule source de vérité pour ce qui part vraiment).
_CODEX_RESPONSE_LIMIT_BY_MODE = {"fast": "120 mots", "review": "600 mots", "deep": "1500 mots"}


def _preview_agent_prompt(agent: str, mode: str, request_summary: str) -> str:
    if agent != "codex":
        # claude.sh n'ajoute aucune consigne textuelle — les restrictions
        # sont des flags CLI (--permission-mode plan, --disallowedTools).
        return request_summary
    limit = _CODEX_RESPONSE_LIMIT_BY_MODE.get(mode, "600 mots")
    prompt = (
        f"Limite de réponse par défaut : {limit}, sauf preuve technique indispensable. "
        "Ne lance jamais cette passerelle depuis l'appel courant (anti-récursion).\n\n"
        f"{request_summary}"
    )
    if mode != "deep":
        prompt = (
            f"Consigne de mode {mode} : ne fais PAS de recherche web sauf si la réponse est "
            "impossible sans, et dis-le si tu y as recours. Réponds avec tes connaissances "
            f"internes en priorité, de façon brève.\n\n{prompt}"
        )
    return prompt


class PrepareExecutionRequest(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/hermes/prepare-execution")
async def prepare_execution(request_body: PrepareExecutionRequest):
    """Seul chemin qui crée une vraie validation à partir de la mission
    proposée — jamais automatique, seulement sur clic explicite de Ruth."""
    mission = _load_json(CURRENT_MISSION_PATH) or {}
    if not mission:
        raise HTTPException(status_code=409, detail="Aucune mission proposée à préparer pour exécution.")
    if mission.get("status") not in ("mission_ready_not_executed",):
        raise HTTPException(status_code=409, detail="Mission non prête (statut inattendu).")

    route = _load_json(CURRENT_AGENT_ROUTE_PATH) or {}
    lead = (route.get("route") or {}).get("lead") or {}
    agent = lead.get("agent") or mission.get("recommended_agent") or "agent inconnu"
    request_summary = mission.get("request_summary", "")
    project_context = mission.get("project_context") or {}
    block = project_context.get("block") or {}
    project_id = project_context.get("project_id")

    action_parts = [f"Déléguer à {agent}", f"demande : {request_summary}"]
    if project_id:
        action_parts.append(f"projet : {project_id}")
    if block.get("num"):
        action_parts.append(f"bloc {block['num']} — {block.get('name', '')}")
    action = " ; ".join(action_parts)

    try:
        request_validation_via_core = _hermes_core_request_validation_api()
        result = request_validation_via_core(
            PERSONAL_ROOT,
            action=action,
            executable=None,
            source="mission_prepare_execution",
            prompt=request_body.note.strip() or f"Préparer l'exécution de la mission proposée : {request_summary}",
            mission_request_id=str(mission.get("request_id") or ""),
        )
    except Exception as exc:
        logger.exception("prepare_execution failed")
        raise HTTPException(status_code=500, detail=f"Impossible de préparer l'exécution : {exc}") from exc

    mode = str((route.get("route") or {}).get("mode") or "review")
    return {
        "ok": True,
        "action": action,
        "validation": result,
        "preview_prompt": _preview_agent_prompt(str(agent), mode, request_summary),
        "preview_agent": agent,
    }


async def _execute_approved_mission_in_background(
    *,
    pending: dict[str, Any],
    action: str,
    initial_result_summary: str,
) -> None:
    """Run one already-approved agent without blocking the HTTP/UI event loop."""
    mission_request_id = str(pending.get("mission_request_id") or "")
    try:
        from hermes_core import execute_approved_agent_via_core

        exec_result = await asyncio.to_thread(execute_approved_agent_via_core, PERSONAL_ROOT)
        execution_status = str(exec_result.get("status") or "blocked")
        result_summary = str(exec_result.get("result_summary") or initial_result_summary)
        if execution_status != "executed":
            _write_hermes_execution_status(
                status="failed",
                mission_request_id=mission_request_id,
                summary=result_summary,
                error=f"Exécution : {execution_status}",
            )
            return

        mission = _load_json(CURRENT_MISSION_PATH) or {}
        block_ctx = (mission.get("project_context") or {}).get("block") or {}
        project_id = (mission.get("project_context") or {}).get("project_id")
        if project_id and block_ctx.get("num"):
            try:
                pb = _project_blocks_module()
                current_block = pb.get_block(project_id, block_ctx["num"])
                if current_block:
                    pb.update_block_status(
                        project_id,
                        block_ctx["num"],
                        new_status=current_block.get("status") or "IN_PROGRESS",
                        evidence=f"Consultation agent réelle (approuvée par Ruth) : {result_summary[:300]}",
                        actor="hermes",
                    )
            except Exception:
                logger.exception("update_block_status failed after async execution")

        _, _, resolve_validation_via_core = _hermes_core_validation_api()
        await asyncio.to_thread(
            resolve_validation_via_core,
            PERSONAL_ROOT,
            resolution="approved",
            execution_status="executed",
            result_summary=result_summary,
        )
        last_validated = _validated_action_record(
            action=action,
            execution_status="executed",
            result_summary=result_summary,
            executable=None,
        )
        _sync_voice_validation_result(last_validated)
        _append_jsonl(
            ACTIONS_PATH,
            {
                "kind": "approved_delegation_handoff_completed",
                "action": action,
                "execution_status": "executed",
                "source": "cockpit_async",
            },
        )
        _write_hermes_execution_status(
            status="completed",
            mission_request_id=mission_request_id,
            summary=result_summary,
        )
    except Exception as exc:
        logger.exception("async approved agent execution failed")
        _write_hermes_execution_status(
            status="failed",
            mission_request_id=mission_request_id,
            error=str(exc),
        )


def _start_approved_mission_execution(*, pending: dict[str, Any], action: str, result_summary: str) -> None:
    mission_request_id = str(pending.get("mission_request_id") or "")
    _write_hermes_execution_status(
        status="running",
        mission_request_id=mission_request_id,
        summary="Mission envoyée à l'agent approuvé.",
    )
    task = asyncio.create_task(
        _execute_approved_mission_in_background(
            pending=pending,
            action=action,
            initial_result_summary=result_summary,
        )
    )
    _HERMES_EXECUTION_TASKS.add(task)
    task.add_done_callback(_HERMES_EXECUTION_TASKS.discard)


@hermes_chat_router.post("/validate")
@router.post("/hermes/validate")
async def hermes_validate(request_body: HermesValidationRequest):
    """Record Ruth's cockpit validation decision without executing external actions."""
    pending = _current_hermes_validation()
    if not pending:
        raise HTTPException(status_code=409, detail="Aucune validation Hermès active à traiter.")

    action = str(pending.get("action") or pending.get("prompt") or "Validation Hermès").strip()
    executable = pending.get("executable")
    executable_value = str(executable).strip() if executable else None
    note = request_body.note.strip()
    core_warning = ""
    executed_flag = False
    agent_info: dict[str, Any] = {}
    validation_state = _load_json(HERMES_VALIDATION_STATE_PATH) or {}
    has_active_validation = isinstance(validation_state.get("active"), dict) and bool(validation_state.get("active"))

    if request_body.decision == "approve":
        running_execution = _current_hermes_execution()
        if running_execution.get("status") == "running":
            return {
                "ok": True,
                "decision": "approve",
                "executed": False,
                "execution_status": "running",
                "message": "Mission déjà en cours d'exécution.",
                "agent": None,
                "pending_validation": None,
                "last_validated_action": None,
                "resolved_validation": None,
                "warning": "",
            }
        result_summary = note or f"Validation cockpit approuvée pour : {action}"
        execution_status = "approved_for_handoff"
        try:
            if not has_active_validation:
                raise RuntimeError("validation_state.active absent")
            approve_delegation_via_core, _, resolve_validation_via_core = _hermes_core_validation_api()
            approval_result: dict[str, Any] = {}
            try:
                approval_result = approve_delegation_via_core(
                    PERSONAL_ROOT,
                    result_summary=result_summary,
                ) or {}
            except Exception as exc:  # pragma: no cover - runtime bridge can be absent.
                core_warning = f"Approbation délégation Hermès partielle : {exc}"

            # Lien mission <-> validation (2026-08-31, contre-revue Codex) :
            # si la mission a changé entre "Préparer l'exécution" et
            # "Approuver" (nouveau message chat entre-temps), approve_delegation_via_core
            # refuse et NE mute PAS l'état vers approved_for_handoff — on
            # s'arrête ici plutôt que de laisser execute_approved_agent_via_core
            # échouer avec un message générique moins clair pour Ruth.
            if approval_result.get("status") == "mission_mismatch":
                core_warning = (
                    "Approbation refusée : la mission a changé depuis la préparation de "
                    "l'exécution (un nouveau message a été envoyé entre-temps). Relance "
                    "la préparation pour la mission actuelle avant d'approuver."
                )
            elif pending.get("source") == "mission_prepare_execution":
                # Ruth a déjà cliqué explicitement « Approuver et envoyer ».
                # Lancer l'agent hors de la requête HTTP évite de figer G et
                # le backend pendant toute la durée d'un audit Codex/Claude.
                # Cette tâche ne peut jamais être créée par le chat seul.
                _start_approved_mission_execution(
                    pending=pending,
                    action=action,
                    result_summary=result_summary,
                )
                last_validated = _validated_action_record(
                    action=action,
                    execution_status="running",
                    result_summary="Mission envoyée à l'agent approuvé.",
                    executable=executable_value,
                )
                _append_jsonl(
                    ACTIONS_PATH,
                    {
                        "kind": "approved_delegation_handoff_started",
                        "action": action,
                        "execution_status": "running",
                        "executable": executable_value,
                        "source": "cockpit_async",
                    },
                )
                return {
                    "ok": True,
                    "decision": "approve",
                    "executed": False,
                    "execution_status": "running",
                    "message": "Mission envoyée. Hermès reste utilisable pendant l'exécution.",
                    "agent": None,
                    "pending_validation": None,
                    "last_validated_action": last_validated,
                    "resolved_validation": None,
                    "warning": core_warning,
                }
                try:
                    from hermes_core import execute_approved_agent_via_core
                    exec_result = execute_approved_agent_via_core(PERSONAL_ROOT)
                    if exec_result.get("status") == "executed":
                        executed_flag = True
                        # Bug réel trouvé par contre-audit Codex (2026-08-31) :
                        # execute_approved_agent_via_core fait avancer le
                        # cycle de vie à "result_logged" en interne, mais le
                        # resolve_validation_via_core plus bas repassait
                        # "approved_for_handoff" (valeur figée avant
                        # l'exécution réelle) — écrasant silencieusement le
                        # bon statut par un ancien. La variable doit refléter
                        # ce qui s'est réellement passé avant ce dernier appel.
                        execution_status = "executed"
                        agent_info = {
                            "requested_agent": exec_result.get("requested_agent") or "",
                            "executed_by": exec_result.get("executed_by") or "",
                            "fallback_used": bool(exec_result.get("fallback_used", False)),
                            "session_log_available": bool(exec_result.get("session_log_available", False)),
                        }
                        result_summary = str(exec_result.get("result_summary") or result_summary)
                        mission = _load_json(CURRENT_MISSION_PATH) or {}
                        block_ctx = (mission.get("project_context") or {}).get("block") or {}
                        project_id = (mission.get("project_context") or {}).get("project_id")
                        if project_id and block_ctx.get("num"):
                            try:
                                pb = _project_blocks_module()
                                current_block = pb.get_block(project_id, block_ctx["num"])
                                if current_block:
                                    pb.update_block_status(
                                        project_id,
                                        block_ctx["num"],
                                        new_status=current_block.get("status") or "IN_PROGRESS",
                                        evidence=f"Consultation agent réelle (approuvée par Ruth) : {result_summary[:300]}",
                                        actor="hermes",
                                    )
                            except Exception:
                                logger.exception("update_block_status failed after real execution")
                    else:
                        core_warning = (core_warning + " " if core_warning else "") + f"Exécution : {exec_result.get('status')}"
                except Exception as exc:
                    logger.exception("execute_approved_agent_via_core failed")
                    core_warning = (core_warning + " " if core_warning else "") + f"Exécution réelle impossible : {exc}"

            resolved = resolve_validation_via_core(
                PERSONAL_ROOT,
                resolution="approved",
                execution_status=execution_status,
                result_summary=result_summary,
            )
        except Exception as exc:
            core_warning = f"Fallback JSON utilisé pour résoudre la validation : {exc}"
            resolved = _direct_clear_hermes_validation(
                pending,
                resolution="approved",
                execution_status=execution_status,
                result_summary=result_summary,
            )

        last_validated = _validated_action_record(
            action=action,
            execution_status=execution_status,
            result_summary=result_summary,
            executable=executable_value,
        )
        _sync_voice_validation_result(last_validated)
        _append_jsonl(
            ACTIONS_PATH,
            {
                "kind": "approved_delegation_handoff",
                "action": action,
                "execution_status": execution_status,
                "executable": executable_value,
                "source": "cockpit",
            },
        )
        return {
            "ok": True,
            "decision": "approve",
            "executed": executed_flag,
            "execution_status": execution_status,
            "message": (
                f"Envoyé à {agent_info.get('executed_by')}."
                + (" (Codex indisponible → bascule vers Claude.)" if agent_info.get("fallback_used") else "")
                if executed_flag and agent_info.get("executed_by")
                else "Validation enregistrée. Aucune action externe n'a été exécutée par le cockpit."
            ),
            "agent": agent_info or None,
            "pending_validation": None,
            "last_validated_action": last_validated,
            "resolved_validation": resolved,
            "warning": core_warning,
        }

    result_summary = note or f"Validation cockpit refusée pour : {action}"
    execution_status = "cancelled"
    try:
        if not has_active_validation:
            raise RuntimeError("validation_state.active absent")
        _, cancel_validation_via_core, _ = _hermes_core_validation_api()
        resolved = cancel_validation_via_core(PERSONAL_ROOT, result_summary=result_summary)
    except Exception as exc:
        core_warning = f"Fallback JSON utilisé pour annuler la validation : {exc}"
        resolved = _direct_clear_hermes_validation(
            pending,
            resolution="rejected",
            execution_status=execution_status,
            result_summary=result_summary,
        )
    _sync_voice_validation_result(None)
    _append_jsonl(
        ACTIONS_PATH,
        {
            "kind": "cancelled_validation",
            "action": action,
            "execution_status": execution_status,
            "executable": executable_value,
            "source": "cockpit",
        },
    )
    return {
        "ok": True,
        "decision": "reject",
        "executed": False,
        "execution_status": execution_status,
        "message": "Validation refusée. Aucune action externe n'a été exécutée.",
        "pending_validation": None,
        "resolved_validation": resolved,
        "warning": core_warning,
    }


@hermes_chat_router.post("/chat")
@router.post("/chat")
async def hermes_chat(request_body: HermesChatRequest, request: Request):
    """Hermes conversation route with local/OpenRouter/OpenAI routing."""
    _start_hermes_chat_observer(request_body.message)
    config = _hermes_chat_config()
    runtime = _hermes_chat_runtime_summary()
    engine_mode = request_body.engine_mode
    grounded_project_reply = _project_block_status_reply(request_body.message)
    if grounded_project_reply:
        return {
            "reply": grounded_project_reply,
            "engine": "grounded",
            "provider": "project-state",
            "mode": engine_mode,
            "model": "none",
            "selection_reason": "État projet publié : réponse factuelle sans appel au modèle.",
            "used_memory": True,
            "source": "hermes_project_state",
            "warning": "",
            "fallback_used": False,
            "budget": runtime["budget"],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "estimated_cost_usd": 0.0,
            "local_limited": False,
        }
    fallback_used = False
    warning = ""
    engine_used = "local"
    provider_used = "local_ollama"
    mode_used = engine_mode
    model_used = config["local_model"]
    message_payload = _hermes_messages(request_body.message, request_body.history)
    selected_provider, selected_model = _select_hermes_provider(request_body.message, engine_mode, config, runtime)
    selection_reason = _describe_hermes_provider_choice(
        request_body.message, engine_mode, selected_provider, str(selected_model), runtime
    )
    api_key_override = request.headers.get("X-Hermes-OpenAI-Key", "").strip()
    openrouter_key_override = request.headers.get("X-Hermes-OpenRouter-Key", "").strip()
    openai_available = bool(runtime["openai_enabled"]) and (bool(runtime["openai_configured"]) or bool(api_key_override))
    openrouter_available = bool(runtime["openrouter_enabled"]) and (
        bool(runtime["openrouter_configured"]) or bool(openrouter_key_override)
    )
    budget = runtime["budget"]
    should_try_paid = selected_provider in {"openai", "openrouter"}
    if int(budget["daily_message_count"]) >= int(config["daily_message_limit"]):
        should_try_paid = False
        warning = "Limite quotidienne de messages cloud atteinte. Hermès repasse en local."
    if bool(budget["blocked"]):
        should_try_paid = False
        warning = str(budget["threshold_message"] or "Budget cloud atteint. Hermès repasse en local gratuit.")

    local_model = _resolve_local_model(request.app.state.engine, str(config["local_model"]))
    local_result: dict[str, Any] | None = None

    if should_try_paid and selected_provider == "openrouter" and openrouter_available:
        try:
            openrouter_result = await _call_openrouter_chat(
                model=str(selected_model),
                messages=message_payload,
                max_tokens=int(config["max_tokens_per_reply"]),
                api_key_override=openrouter_key_override,
            )
            usage_entry = _record_paid_usage(
                provider="openrouter",
                model=str(selected_model),
                usage=openrouter_result["usage"],
                route="/api/hermes/chat",
                session_id=request_body.session_id,
            )
            refreshed_budget = _budget_state(config)
            threshold_message = str(refreshed_budget.get("threshold_message", "") or "")
            return {
                "reply": openrouter_result["reply"],
                "engine": "openrouter",
                "provider": "openrouter",
                "mode": mode_used,
                "model": str(selected_model),
                "selection_reason": selection_reason,
                "used_memory": True,
                "source": "hermes_openrouter",
                "warning": threshold_message,
                "fallback_used": False,
                "budget": refreshed_budget,
                "usage": openrouter_result["usage"],
                "estimated_cost_usd": usage_entry["estimated_cost_usd"],
                "local_limited": False,
            }
        except Exception as exc:
            fallback_used = True
            fallback_model = str(config["openrouter_economy_model"])
            if str(selected_model) != fallback_model:
                try:
                    openrouter_result = await _call_openrouter_chat(
                        model=fallback_model,
                        messages=message_payload,
                        max_tokens=int(config["max_tokens_per_reply"]),
                        api_key_override=openrouter_key_override,
                    )
                    usage_entry = _record_paid_usage(
                        provider="openrouter",
                        model=fallback_model,
                        usage=openrouter_result["usage"],
                        route="/api/hermes/chat",
                        session_id=request_body.session_id,
                    )
                    refreshed_budget = _budget_state(config)
                    threshold_message = (
                        str(refreshed_budget.get("threshold_message", "") or "")
                        or f"Le modèle {selected_model} a échoué. Hermès a basculé sur le mode économique."
                    )
                    return {
                        "reply": openrouter_result["reply"],
                        "engine": "openrouter",
                        "provider": "openrouter",
                        "mode": mode_used,
                        "model": fallback_model,
                        "selection_reason": f"{selection_reason} Le premier modèle a échoué, Hermès a basculé sur le mode économique.",
                        "used_memory": True,
                        "source": "hermes_openrouter",
                        "warning": threshold_message,
                        "fallback_used": True,
                        "budget": refreshed_budget,
                        "usage": openrouter_result["usage"],
                        "estimated_cost_usd": usage_entry["estimated_cost_usd"],
                        "local_limited": False,
                    }
                except Exception as fallback_exc:
                    warning = f"OpenRouter indisponible pour l’instant ({exc}; fallback économique: {fallback_exc}). "
            else:
                warning = f"OpenRouter indisponible pour l’instant ({exc}). "
            if openai_available:
                warning += "Hermès essaie OpenAI en secours."
            else:
                engine_used = "local"
                provider_used = "local_ollama"
                model_used = local_model
                warning += "Hermès repasse en local."

    openai_fallback_requested = selected_provider == "openrouter" and not openrouter_available and openai_available
    if openai_fallback_requested and not warning:
        warning = "OpenRouter n’est pas disponible ici. Hermès utilise OpenAI en secours."
    if should_try_paid and (selected_provider == "openai" or (fallback_used and openai_available) or openai_fallback_requested):
        try:
            openai_result = await _call_openai_chat(
                model=str(config["openai_model"]),
                messages=message_payload,
                max_tokens=int(config["max_tokens_per_reply"]),
                api_key_override=api_key_override,
            )
            usage_entry = _record_paid_usage(
                provider="openai",
                model=str(config["openai_model"]),
                usage=openai_result["usage"],
                route="/api/hermes/chat",
                session_id=request_body.session_id,
            )
            refreshed_budget = _budget_state(config)
            threshold_message = str(refreshed_budget.get("threshold_message", "") or warning)
            return {
                "reply": openai_result["reply"],
                "engine": "openai",
                "provider": "openai",
                "mode": mode_used,
                "model": str(config["openai_model"]),
                "selection_reason": selection_reason,
                "used_memory": True,
                "source": "hermes_openai",
                "warning": threshold_message,
                "fallback_used": fallback_used,
                "budget": refreshed_budget,
                "usage": openai_result["usage"],
                "estimated_cost_usd": usage_entry["estimated_cost_usd"],
                "local_limited": False,
            }
        except Exception as exc:
            fallback_used = True
            engine_used = "local"
            provider_used = "local_ollama"
            model_used = local_model
            warning = f"OpenAI indisponible pour l’instant ({exc}). Hermès repasse en local."

    if selected_provider == "openrouter" and should_try_paid and not warning and not (openrouter_available or openrouter_key_override):
        fallback_used = True
        warning = (
            "OpenRouter n’est pas configuré ou n’est pas autorisé. "
            + ("Hermès utilise OpenAI en secours." if openai_available else "Hermès répond en mode local limité.")
        )

    if selected_provider == "openai" and should_try_paid and not warning and not (openai_available or api_key_override):
        fallback_used = True
        warning = "OpenAI n’est pas configuré ou n’est pas autorisé. Hermès répond en mode local limité."

    try:
        local_result = _call_local_chat(
            engine=request.app.state.engine,
            model=local_model,
            messages=message_payload,
            max_tokens=int(config["max_tokens_per_reply"]),
        )
    except Exception as exc:
        logger.exception("hermes local chat failed")
        return {
            "reply": "",
            "engine": "error",
            "mode": mode_used,
            "model": model_used,
            "selection_reason": selection_reason,
            "used_memory": True,
            "source": "hermes_error",
            "warning": f"Hermès n’a pas réussi à répondre : {exc}",
            "fallback_used": fallback_used,
            "budget": _budget_state(config),
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "estimated_cost_usd": 0.0,
            "local_limited": True,
        }

    if engine_mode == "auto" and runtime["status"] == "local_limited" and not warning:
        warning = "Hermès est actuellement en mode local limité."

    return {
        "reply": local_result["reply"],
        "engine": engine_used,
        "provider": provider_used,
        "mode": mode_used,
        "model": model_used,
        "selection_reason": (
            "Le budget ou la disponibilité cloud a forcé Hermès à répondre en local gratuit."
            if fallback_used or engine_used == "local"
            else selection_reason
        ),
        "used_memory": True,
        "source": "hermes_local",
        "warning": warning,
        "fallback_used": fallback_used,
        "budget": _budget_state(config),
        "usage": local_result["usage"],
        "estimated_cost_usd": 0.0,
        "local_limited": True,
    }
