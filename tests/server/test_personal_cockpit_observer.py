import asyncio
import json
from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server import personal_cockpit as cockpit

PERSONAL_ROOT = Path.home() / ".openjarvis" / "jarvis-personal"
if str(PERSONAL_ROOT) not in sys.path:
    sys.path.insert(0, str(PERSONAL_ROOT))

import hermes_core
import project_blocks


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


def test_explicit_work_request_returns_the_structured_prepared_mission(monkeypatch):
    def orchestrate(*_args, **kwargs):
        assert kwargs["observation_only"] is True
        assert kwargs["source"] == "hermes_chat_structured_mission"
        return {
            "current_request": {"request_id": "mission-42"},
            "current_tool_decision": {"recommended_tool": "codex"},
            "current_mission": {
                "project_context": {
                    "project_id": "pedro",
                    "block": {"num": "08", "name": "Stock Pedro"},
                }
            },
            "current_delegation": {"delegation_status": "observed_not_delegated"},
        }

    monkeypatch.setattr(cockpit, "_hermes_core_observer_api", lambda: orchestrate)

    payload = asyncio.run(
        cockpit._prepare_hermes_chat_mission_response(
            "Hermès, il faut préparer une vérification lecture seule du projet Pedro, bloc 08. Ne modifie rien."
        )
    )

    assert payload["source"] == "hermes_structured_mission"
    assert payload["mission_request_id"] == "mission-42"
    assert payload["delegation_status"] == "observed_not_delegated"
    assert "Mission préparée" in payload["reply"]
    assert "Pedro" in payload["reply"]
    assert "bloc 08" in payload["reply"]
    assert "Stock Pedro" in payload["reply"]
    assert "Voie recommandée" in payload["reply"]
    assert "codex" in payload["reply"]


def test_chat_returns_structured_mission_before_any_model_reply(monkeypatch):
    async def prepared(_message: str):
        return {
            "reply": "Mission préparée — Pedro · bloc 08.",
            "source": "hermes_structured_mission",
            "mission_request_id": "mission-42",
            "delegation_status": "observed_not_delegated",
        }

    monkeypatch.setattr(cockpit, "_prepare_hermes_chat_mission_response", prepared)
    monkeypatch.setattr(cockpit, "_hermes_chat_config", lambda: {"local_model": "unused"})
    monkeypatch.setattr(cockpit, "_hermes_chat_runtime_summary", lambda: {"budget": {}})

    response = asyncio.run(
        cockpit.hermes_chat(
            cockpit.HermesChatRequest(message="Hermès, il faut préparer une vérification lecture seule du projet Pedro."),
            request=None,
        )
    )

    assert response["source"] == "hermes_structured_mission"
    assert response["mission_request_id"] == "mission-42"
    assert response["delegation_status"] == "observed_not_delegated"
    assert response["engine"] == "hermes-core"


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


def test_approved_agent_is_not_completed_until_adv_rescan_syncs_source(tmp_path, monkeypatch):
    launch = tmp_path / "ADV_LAUNCH_BLOCKS.md"
    checklist = tmp_path / "ADV_MASTER_CHECKLIST.md"
    launch.write_text("## Block 1 — Product core\n", encoding="utf-8")
    checklist.write_text("## E. Checks\n- [ ] Verify PDF generation output\n", encoding="utf-8")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "pdf.ts").write_text("ready\n", encoding="utf-8")
    monkeypatch.setattr(project_blocks, "ADV_LAUNCH_BLOCKS_PATH", launch)
    monkeypatch.setattr(project_blocks, "ADV_MASTER_CHECKLIST_PATH", checklist)
    scope = project_blocks.snapshot_block("adv", "1")
    item_id = scope["items"][0]["item_id"]

    mission_path = tmp_path / "current_mission.json"
    mission_path.write_text(json.dumps({
        "request_id": "mission-sync-42",
        "project_context": {
            "project_id": "adv", "project_root": str(tmp_path),
            "block": {"num": "1", "name": "Product core"},
            "reconciliation_scope": scope,
        },
    }), encoding="utf-8")
    monkeypatch.setattr(cockpit, "CURRENT_MISSION_PATH", mission_path)
    monkeypatch.setattr(cockpit, "HERMES_EXECUTION_STATUS_PATH", tmp_path / "execution.json")
    monkeypatch.setattr(cockpit, "ACTIONS_PATH", tmp_path / "actions.jsonl")
    monkeypatch.setattr(cockpit, "_project_blocks_module", lambda: project_blocks)
    recorded = []
    report = (
        "Agent finished\nRUTHOS_RESULT_JSON\n"
        + json.dumps({"project_id": "adv", "block_id": "1", "items": [{
            "item_id": item_id, "done": True, "verified": True, "tested": True,
            "evidence": "PDF test passed", "files": ["src/pdf.ts"], "tests": ["unit"],
        }]})
    )
    monkeypatch.setattr(hermes_core, "execute_approved_agent_via_core", lambda *_a, **_k: {
        "status": "executed", "execution_capability": "controlled_write", "result_summary": report, "executed_by": "codex", "requested_agent": "codex",
    })
    monkeypatch.setattr(hermes_core, "record_delegation_result_via_core", lambda *_a, **kw: recorded.append(kw))
    monkeypatch.setattr(cockpit, "_hermes_core_validation_api", lambda: (None, None, lambda *_a, **_k: {}))

    asyncio.run(cockpit._execute_approved_mission_in_background(
        pending={"mission_request_id": "mission-sync-42"},
        action="Déléguer à Codex",
        initial_result_summary="approved",
    ))

    assert cockpit._current_hermes_execution()["status"] == "completed_sync"
    assert recorded[-1]["execution_status"] == "completed_sync"
    assert "- [x] Verify PDF generation output" in checklist.read_text(encoding="utf-8")


def test_read_only_agent_review_never_mutates_a_project_block(tmp_path, monkeypatch):
    mission_path = tmp_path / "current_mission.json"
    mission_path.write_text(json.dumps({"request_id": "review-only"}), encoding="utf-8")
    monkeypatch.setattr(cockpit, "CURRENT_MISSION_PATH", mission_path)
    monkeypatch.setattr(cockpit, "HERMES_EXECUTION_STATUS_PATH", tmp_path / "execution.json")
    monkeypatch.setattr(cockpit, "ACTIONS_PATH", tmp_path / "actions.jsonl")
    recorded = []
    monkeypatch.setattr(hermes_core, "execute_approved_agent_via_core", lambda *_a, **_k: {
        "status": "executed", "execution_capability": "read_only_review", "result_summary": "Audit trouvé.",
    })
    monkeypatch.setattr(hermes_core, "record_delegation_result_via_core", lambda *_a, **kw: recorded.append(kw))
    monkeypatch.setattr(cockpit, "_hermes_core_validation_api", lambda: (None, None, lambda *_a, **_k: {}))

    asyncio.run(cockpit._execute_approved_mission_in_background(
        pending={"mission_request_id": "review-only"},
        action="Déléguer à Codex",
        initial_result_summary="approved",
    ))

    status = cockpit._current_hermes_execution()
    assert status["status"] == "review_completed"
    assert "lecture seule" in status["error"]
    assert recorded[-1]["execution_status"] == "review_completed"


def test_agent_execution_with_plain_text_is_reported_as_sync_failed(tmp_path, monkeypatch):
    mission_path = tmp_path / "current_mission.json"
    mission_path.write_text(json.dumps({
        "request_id": "mission-sync-fail",
        "project_context": {"project_id": "adv", "project_root": str(tmp_path), "block": {"num": "1"}},
    }), encoding="utf-8")
    monkeypatch.setattr(cockpit, "CURRENT_MISSION_PATH", mission_path)
    monkeypatch.setattr(cockpit, "HERMES_EXECUTION_STATUS_PATH", tmp_path / "execution.json")
    monkeypatch.setattr(cockpit, "ACTIONS_PATH", tmp_path / "actions.jsonl")
    recorded = []
    monkeypatch.setattr(hermes_core, "execute_approved_agent_via_core", lambda *_a, **_k: {
        "status": "executed", "execution_capability": "controlled_write", "result_summary": "rapport libre sans contrat",
    })
    monkeypatch.setattr(hermes_core, "record_delegation_result_via_core", lambda *_a, **kw: recorded.append(kw))
    monkeypatch.setattr(cockpit, "_hermes_core_validation_api", lambda: (None, None, lambda *_a, **_k: {}))

    asyncio.run(cockpit._execute_approved_mission_in_background(
        pending={"mission_request_id": "mission-sync-fail"},
        action="Déléguer à Codex",
        initial_result_summary="approved",
    ))

    status = cockpit._current_hermes_execution()
    assert status["status"] == "sync_failed"
    assert "Travail exécuté — synchronisation de l’état projet échouée" in status["error"]
    assert recorded[-1]["execution_status"] == "sync_failed"


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
        "proofs": [],
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


def test_project_state_exposes_only_safe_matching_proofs(tmp_path, monkeypatch):
    published = tmp_path / "snapshots"
    published.mkdir()
    (published / "adv.snapshot.json").write_text(json.dumps({
        "schema_version": "1.0",
        "project": {"id": "adv", "name": "ADV"},
        "freshness": {},
        "state": {},
    }), encoding="utf-8")
    proofs = tmp_path / "proofs.json"
    proofs.write_text(json.dumps({
        "schema_version": "1.0",
        "projects": {
            "adv": [{
                "id": "adv-pdf-device",
                "label": "Parcours PDF iPhone validé",
                "status": "validated",
                "observed_at": "2026-09-02T20:00:00+00:00",
                "source": "Validation Ruth",
                "verification": "human_confirmed",
            }],
            "other": [{"id": "invalid"}],
        },
    }), encoding="utf-8")
    monkeypatch.setattr(cockpit, "PROJECT_STATE_SNAPSHOTS_DIR", published)
    monkeypatch.setattr(cockpit, "PROJECT_STATE_PROOFS_PATH", proofs)

    payload = asyncio.run(cockpit.get_project_state())

    assert payload["projects"][0]["proofs"] == [{
        "id": "adv-pdf-device",
        "label": "Parcours PDF iPhone validé",
        "status": "validated",
        "observed_at": "2026-09-02T20:00:00+00:00",
        "source": "Validation Ruth",
        "verification": "human_confirmed",
    }]


def test_adv_snapshot_push_republishes_local_project_state(tmp_path, monkeypatch):
    class RequestWithPayload:
        async def json(self):
            return {
                "generated_at": "2026-09-02T08:00:00+00:00",
                "abonnements": {"actifs": 7},
                "utilisateurs": {"total": 9},
                "usage": {"devis_total": 11, "factures_total": 12},
                "sante_technique": {"services": {"firestore": "ok"}},
            }

    source_path = tmp_path / "adv_snapshot.json"
    output_path = tmp_path / "snapshots" / "adv.snapshot.json"
    monkeypatch.setattr(cockpit, "ADV_SNAPSHOT_PATH", source_path)
    monkeypatch.setattr(cockpit, "ADV_PROJECT_STATE_OUTPUT_PATH", output_path)

    result = asyncio.run(cockpit.receive_adv_snapshot(RequestWithPayload()))

    assert result == {"ok": True, "project_state_published": True}
    published = json.loads(output_path.read_text(encoding="utf-8"))
    assert published["project"]["id"] == "adv"
    assert "7 abonnement(s) actif(s)" in published["state"]["summary"]
    assert all(item["verification"] == "unverified" for item in published["kpis"])


def test_only_explicit_verification_requests_dispatch_reconciliation_review():
    assert cockpit._should_dispatch_reconciliation_review("Hermès, vérifie le bloc 1 du projet ADV.")
    assert cockpit._should_dispatch_reconciliation_review("J'ai terminé le bloc Sécurité, confirme.")
    assert cockpit._should_dispatch_reconciliation_review("Synchronise le bloc Marketing d'ADV.")

    assert not cockpit._should_dispatch_reconciliation_review("Bonjour Hermès")
    assert not cockpit._should_dispatch_reconciliation_review("Quel est le prochain bloc Pedro ?")
    assert not cockpit._should_dispatch_reconciliation_review("................")


def test_verification_and_work_intents_never_both_fire_on_the_same_message():
    """Les deux détecteurs doivent rester mutuellement exclusifs — sinon un
    message déclenche à la fois une mission ET une revue, ambigu pour Ruth."""
    verification_messages = [
        "Hermès, vérifie le bloc 1 du projet ADV.",
        "J'ai terminé le bloc Sécurité, confirme.",
        "Synchronise le bloc Marketing d'ADV.",
        "Relis le bloc 08 de Pedro.",
    ]
    work_messages = [
        "Hermès, il faut travailler le projet Pedro, bloc Sécurité.",
        "Continue le bloc Marketing d'ADV.",
        "Aide-moi à préparer le devis Pedro.",
    ]
    for message in verification_messages:
        assert cockpit._should_dispatch_reconciliation_review(message)
        assert not cockpit._should_prepare_hermes_mission(message)
    for message in work_messages:
        assert cockpit._should_prepare_hermes_mission(message)
        assert not cockpit._should_dispatch_reconciliation_review(message)


def test_dispatch_reconciliation_review_reports_unresolved_project_clearly(monkeypatch):
    def observer(*_args, **_kwargs):
        return {"current_request": {"request_id": "req-1"}, "current_mission": {"project_context": {}}}

    monkeypatch.setattr(cockpit, "_hermes_core_observer_api", lambda: observer)

    payload = asyncio.run(cockpit._dispatch_reconciliation_review_chat("Hermès, vérifie le bloc."))

    assert payload["source"] == "hermes_reconciliation_review_unresolved"
    assert "projet et le bloc" in payload["reply"]


def test_dispatch_reconciliation_review_launches_background_task(monkeypatch):
    def observer(*_args, **kwargs):
        assert kwargs["observation_only"] is True
        assert kwargs["source"] == "hermes_chat_reconciliation_review"
        return {
            "current_request": {"request_id": "req-verif-1"},
            "current_mission": {
                "project_context": {
                    "project_id": "adv",
                    "project_name": "ADV",
                    "project_root": "/tmp/adv",
                    "block": {"num": "1", "name": "Cœur produit"},
                }
            },
        }

    status_calls = []
    monkeypatch.setattr(cockpit, "_hermes_core_observer_api", lambda: observer)
    monkeypatch.setattr(
        cockpit, "_write_hermes_execution_status",
        lambda **kwargs: status_calls.append(kwargs),
    )

    async def fake_review(**_kwargs):
        return None

    monkeypatch.setattr(cockpit, "_run_independent_reconciliation_review", fake_review)

    payload = asyncio.run(
        cockpit._dispatch_reconciliation_review_chat("Hermès, vérifie le bloc 1 du projet ADV.")
    )

    assert payload["source"] == "hermes_reconciliation_review_dispatched"
    assert payload["mission_request_id"] == "req-verif-1"
    assert "ADV" in payload["reply"]
    assert "Cœur produit" in payload["reply"]
    assert status_calls[0]["status"] == "running"
    assert status_calls[0]["mission_request_id"] == "req-verif-1"
