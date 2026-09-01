import asyncio
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server import personal_cockpit as cockpit


def test_chat_observer_is_background_only_and_requests_no_execution(monkeypatch):
    calls = []

    def observer(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(cockpit, "_hermes_core_observer_api", lambda: observer)
    asyncio.run(cockpit._observe_hermes_chat_request("Prépare un plan sans agir."))

    assert len(calls) == 1
    _, kwargs = calls[0]
    assert kwargs["observation_only"] is True
    assert kwargs["source"] == "hermes_chat_observer"


def test_only_explicit_work_requests_become_hermes_missions():
    assert cockpit._should_prepare_hermes_mission("Hermès, il faut travailler le projet Pedro, bloc Sécurité.")
    assert cockpit._should_prepare_hermes_mission("Continue le bloc Marketing d'ADV.")
    assert cockpit._should_prepare_hermes_mission("Aide-moi à préparer le devis Pedro.")

    assert not cockpit._should_prepare_hermes_mission("Bonjour Hermès")
    assert not cockpit._should_prepare_hermes_mission("Quel est le prochain bloc Pedro ?")
    assert not cockpit._should_prepare_hermes_mission("Hermès, quelle est ma priorité réelle aujourd’hui pour terminer RuthOS ?")
    assert not cockpit._should_prepare_hermes_mission("................")
    assert not cockpit._should_prepare_hermes_mission("C'est un bloc, Pedro.")


def test_greeting_never_starts_the_mission_observer(monkeypatch):
    calls = []

    async def observer(message: str):
        calls.append(message)

    async def exercise():
        monkeypatch.setattr(cockpit, "_observe_hermes_chat_request", observer)
        task = cockpit._start_hermes_chat_observer("Bonjour Hermès")
        await task

    asyncio.run(exercise())
    assert calls == []


def test_approved_execution_reports_running_before_background_completion(tmp_path, monkeypatch):
    status_path = tmp_path / "current_execution.json"
    started = []

    async def background(**kwargs):
        started.append(kwargs)

    async def exercise():
        monkeypatch.setattr(cockpit, "HERMES_EXECUTION_STATUS_PATH", status_path)
        monkeypatch.setattr(cockpit, "_execute_approved_mission_in_background", background)
        cockpit._start_approved_mission_execution(
            pending={"mission_request_id": "mission-42"},
            action="Déléguer à Codex",
            result_summary="Approuvée par Ruth",
        )
        assert cockpit._current_hermes_execution()["status"] == "running"
        task = next(iter(cockpit._HERMES_EXECUTION_TASKS))
        await task

    asyncio.run(exercise())
    assert started[0]["pending"]["mission_request_id"] == "mission-42"


def test_background_observer_task_is_kept_until_completion(monkeypatch):
    async def observer(_message: str):
        await asyncio.sleep(0)

    async def exercise():
        monkeypatch.setattr(cockpit, "_observe_hermes_chat_request", observer)
        task = cockpit._start_hermes_chat_observer("Prépare une analyse sans agir")
        assert task in cockpit._HERMES_OBSERVER_TASKS
        await task
        assert task not in cockpit._HERMES_OBSERVER_TASKS

    asyncio.run(exercise())


def test_jsonl_tail_returns_only_the_latest_valid_records(tmp_path):
    history = tmp_path / "sessions.jsonl"
    rows = [{"turn": index} for index in range(200)]
    history.write_text(
        "\n".join(json.dumps(row) for row in rows) + "\nnot-json\n",
        encoding="utf-8",
    )

    assert cockpit._load_jsonl_tail(history, 3) == rows[-3:]


def test_proposed_mission_keeps_history_separate_from_current_observation(tmp_path, monkeypatch):
    mission_path = tmp_path / "current_mission.json"
    route_path = tmp_path / "current_agent_route.json"
    core_state_path = tmp_path / "core_state.json"
    validation_path = tmp_path / "validation_state.json"
    mission_path.write_text(json.dumps({"request_id": "current", "status": "mission_ready_not_executed"}), encoding="utf-8")
    route_path.write_text(json.dumps({"status": "route_ready_not_executed"}), encoding="utf-8")
    core_state_path.write_text(json.dumps({"mission_history": [{"request_id": "completed", "execution_status": "executed", "result_summary": "MISSION_TEST_RECU + TESTED"}]}), encoding="utf-8")
    validation_path.write_text(json.dumps({"last_resolved": {"execution_status": "executed", "result_summary": "MISSION_TEST_RECU + TESTED"}}), encoding="utf-8")
    monkeypatch.setattr(cockpit, "CURRENT_MISSION_PATH", mission_path)
    monkeypatch.setattr(cockpit, "CURRENT_AGENT_ROUTE_PATH", route_path)
    monkeypatch.setattr(cockpit, "HERMES_CORE_STATE_PATH", core_state_path)
    monkeypatch.setattr(cockpit, "HERMES_VALIDATION_STATE_PATH", validation_path)

    payload = asyncio.run(cockpit.get_proposed_mission())

    assert payload["mission"]["request_id"] == "current"
    assert payload["mission_history"][0]["request_id"] == "completed"
    assert payload["last_execution"]["result_summary"] == "MISSION_TEST_RECU + TESTED"


def test_pending_handoff_is_never_presented_as_a_real_execution(tmp_path, monkeypatch):
    mission_path = tmp_path / "current_mission.json"
    route_path = tmp_path / "current_agent_route.json"
    core_state_path = tmp_path / "core_state.json"
    validation_path = tmp_path / "validation_state.json"
    mission_path.write_text(json.dumps({"request_id": "current", "status": "mission_ready_not_executed"}), encoding="utf-8")
    route_path.write_text("{}", encoding="utf-8")
    core_state_path.write_text("{}", encoding="utf-8")
    validation_path.write_text(json.dumps({"last_resolved": {"execution_status": "approved_for_handoff", "result_summary": "Validation seulement"}}), encoding="utf-8")
    monkeypatch.setattr(cockpit, "CURRENT_MISSION_PATH", mission_path)
    monkeypatch.setattr(cockpit, "CURRENT_AGENT_ROUTE_PATH", route_path)
    monkeypatch.setattr(cockpit, "HERMES_CORE_STATE_PATH", core_state_path)
    monkeypatch.setattr(cockpit, "HERMES_VALIDATION_STATE_PATH", validation_path)

    payload = asyncio.run(cockpit.get_proposed_mission())

    assert payload["last_execution"] is None


def test_executed_current_mission_is_not_still_proposed(tmp_path, monkeypatch):
    mission_path = tmp_path / "current_mission.json"
    route_path = tmp_path / "current_agent_route.json"
    core_state_path = tmp_path / "core_state.json"
    validation_path = tmp_path / "validation_state.json"
    mission_path.write_text(json.dumps({"request_id": "already-executed", "status": "mission_ready_not_executed"}), encoding="utf-8")
    route_path.write_text("{}", encoding="utf-8")
    core_state_path.write_text(json.dumps({"mission_history": [{
        "request_id": "already-executed",
        "execution_status": "executed",
        "result_summary": "Garde-fou DON validé par Ruth",
        "executed_by": "codex",
    }]}), encoding="utf-8")
    validation_path.write_text(json.dumps({"last_resolved": {
        "execution_status": "executed",
        "result_summary": "Ancien état non corrélé",
    }}), encoding="utf-8")
    monkeypatch.setattr(cockpit, "CURRENT_MISSION_PATH", mission_path)
    monkeypatch.setattr(cockpit, "CURRENT_AGENT_ROUTE_PATH", route_path)
    monkeypatch.setattr(cockpit, "HERMES_CORE_STATE_PATH", core_state_path)
    monkeypatch.setattr(cockpit, "HERMES_VALIDATION_STATE_PATH", validation_path)

    payload = asyncio.run(cockpit.get_proposed_mission())

    assert payload["has_mission"] is False
    assert payload["mission"] is None
    assert payload["last_execution"]["executed_by"] == "codex"
    assert payload["last_execution"]["contains_unverified_ruth_decision_claim"] is True


def test_project_state_exposes_only_valid_published_snapshots(tmp_path, monkeypatch):
    published = tmp_path / "snapshots"
    published.mkdir()
    (published / "pedro.snapshot.json").write_text(json.dumps({
        "schema_version": "1.0",
        "project": {"id": "pedro-os", "name": "Pedro OS", "root": "/private/path"},
        "freshness": {"status": "current", "observed_at": "2026-08-31T20:00:00+02:00", "stale_after_days": 7},
        "state": {"lifecycle": "active", "summary": "Réel", "active_block": "Sécurité", "next_action": "Tester", "decisions_required": [], "blockers": [], "risks": []},
        "provenance": [{"source": "private.md"}],
    }), encoding="utf-8")
    (published / "broken.snapshot.json").write_text("not-json", encoding="utf-8")
    monkeypatch.setattr(cockpit, "PROJECT_STATE_SNAPSHOTS_DIR", published)

    payload = asyncio.run(cockpit.get_project_state())

    assert payload["source"] == "project-state"
    assert payload["projects"] == [{
        "schema_version": "1.0",
        "project": {"id": "pedro-os", "name": "Pedro OS"},
        "freshness": {"status": "current", "observed_at": "2026-08-31T20:00:00+02:00", "stale_after_days": 7},
        "state": {"lifecycle": "active", "summary": "Réel", "active_block": "Sécurité", "next_action": "Tester", "decisions_required": [], "blockers": [], "risks": []},
    }]
    assert payload["warnings"] == ["Snapshot ignoré car invalide : broken.snapshot.json"]


def test_project_state_route_is_mounted_and_read_only(tmp_path, monkeypatch):
    published = tmp_path / "snapshots"
    published.mkdir()
    (published / "pedro.snapshot.json").write_text(json.dumps({
        "schema_version": "1.0",
        "project": {"id": "pedro-os", "name": "Pedro OS"},
        "freshness": {},
        "state": {},
    }), encoding="utf-8")
    monkeypatch.setattr(cockpit, "PROJECT_STATE_SNAPSHOTS_DIR", published)
    app = FastAPI()
    app.include_router(cockpit.router)

    response = TestClient(app).get("/v1/personal-cockpit/project-state")

    assert response.status_code == 200
    assert response.json()["projects"][0]["project"] == {"id": "pedro-os", "name": "Pedro OS"}
