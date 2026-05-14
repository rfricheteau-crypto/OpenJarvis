"""Personal Jarvis cockpit routes backed by jarvis-personal runtime files."""

import hashlib
import json
import os
import re
from collections import deque
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

PERSONAL_ROOT = Path.home() / ".openjarvis" / "jarvis-personal"
VOICE_DIR = PERSONAL_ROOT / "runtime" / "voice"
WORKING_DIR = PERSONAL_ROOT / "memory" / "working"
INTEGRATIONS_DIR = PERSONAL_ROOT / "integrations"
HERMES_DIR = PERSONAL_ROOT / "runtime" / "hermes"

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
HERMES_RECENT_TRACE_JSON_PATH = HERMES_DIR / "recent_trace.json"
HERMES_RECENT_TRACE_JSONL_PATH = HERMES_DIR / "recent_trace.jsonl"
HERMES_OPENAI_USAGE_LOG_PATH = HERMES_DIR / "openai_usage_log.jsonl"
HERMES_OPENAI_BUDGET_STATE_PATH = HERMES_DIR / "openai_budget_state.json"
HERMES_PENDING_VALIDATIONS_PATH = HERMES_DIR / "pending_validations.json"
HERMES_VALIDATION_STATE_PATH = HERMES_DIR / "validation_state.json"
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
    "Tu es Hermès, l'assistant de travail personnel de Ruth. "
    "Tu réponds en français, de façon naturelle, claire, directe, protectrice et utile. "
    "Tu aides Ruth comme dans une vraie discussion normale. "
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
    if len(text.strip()) < 80 and text.count("?") <= 1 and not any(keyword in text for keyword in ("adv", "jarvis", "herm", "projet", "strategie", "stratégie")):
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
    if not path.exists():
        return []
    rows: deque[dict[str, Any]] = deque(maxlen=limit)
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        return []
    return list(rows)


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
    recent_trace = _load_recent_trace()
    return {
        "current_request": current_request or core_state.get("current_request"),
        "current_packet": current_packet or core_state.get("current_packet"),
        "current_tool_decision": current_tool_decision or core_state.get("current_tool_decision"),
        "current_delegation": current_delegation or core_state.get("current_delegation"),
        "current_tool_research": current_tool_research or core_state.get("current_tool_research"),
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
    lifecycle_status = str(
        lifecycle.get("lifecycle_status")
        or core_state.get("last_validation_lifecycle")
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
        or ""
    ).strip()
    result_logged_at = str(
        delegation.get("result_logged_at")
        or lifecycle.get("result_logged_at")
        or lifecycle.get("executed_at")
        or lifecycle.get("last_lifecycle_update_at")
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
        if risk_level in {"critical", "high"}:
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
    content = path.read_text(encoding="utf-8")
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
                "hermes_recent_trace_json": HERMES_RECENT_TRACE_JSON_PATH,
                "hermes_recent_trace_jsonl": HERMES_RECENT_TRACE_JSONL_PATH,
            }.items()
        },
    }


def _parse_ideas_inbox() -> list[dict[str, Any]]:
    """Parse ideas-inbox.md and return structured idea list."""
    if not OBSIDIAN_IDEAS_PATH.exists():
        return []
    content = OBSIDIAN_IDEAS_PATH.read_text(encoding="utf-8")
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
            content = path.read_text(encoding="utf-8")
            result[key] = content[:max_len]
            result[key + "_path"] = str(path)
    # Codex update log — last ~1 500 chars (most recent entries)
    codex_log_path = OBSIDIAN_ROOT / "CODEX_RUTH_OS" / "07_LOG" / "UPDATE_LOG.md"
    if codex_log_path.exists():
        content = codex_log_path.read_text(encoding="utf-8")
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
    validation_state = _load_json(HERMES_VALIDATION_STATE_PATH) or {}
    has_active_validation = isinstance(validation_state.get("active"), dict) and bool(validation_state.get("active"))

    if request_body.decision == "approve":
        result_summary = note or f"Validation cockpit approuvée pour : {action}"
        execution_status = "approved_for_handoff"
        try:
            if not has_active_validation:
                raise RuntimeError("validation_state.active absent")
            approve_delegation_via_core, _, resolve_validation_via_core = _hermes_core_validation_api()
            try:
                approve_delegation_via_core(
                    PERSONAL_ROOT,
                    result_summary=result_summary,
                )
            except Exception as exc:  # pragma: no cover - runtime bridge can be absent.
                core_warning = f"Approbation délégation Hermès partielle : {exc}"
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
            "executed": False,
            "execution_status": execution_status,
            "message": "Validation enregistrée. Aucune action externe n'a été exécutée par le cockpit.",
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
    config = _hermes_chat_config()
    runtime = _hermes_chat_runtime_summary()
    engine_mode = request_body.engine_mode
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
