from pathlib import Path
import sys


PERSONAL_ROOT = Path.home() / ".openjarvis" / "jarvis-personal"
if str(PERSONAL_ROOT) not in sys.path:
    sys.path.insert(0, str(PERSONAL_ROOT))

import project_blocks


def test_adv_reconciliation_only_marks_a_proven_checklist_item(tmp_path, monkeypatch):
    launch = tmp_path / "ADV_LAUNCH_BLOCKS.md"
    checklist = tmp_path / "ADV_MASTER_CHECKLIST.md"
    launch.write_text("## Block 1 — Product core\n**Statut** : Partial\n", encoding="utf-8")
    checklist.write_text(
        "## E. Product checks\n- [ ] Verify PDF generation output\n",
        encoding="utf-8",
    )
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "pdf.ts").write_text("export const pdf = true\n", encoding="utf-8")
    monkeypatch.setattr(project_blocks, "ADV_LAUNCH_BLOCKS_PATH", launch)
    monkeypatch.setattr(project_blocks, "ADV_MASTER_CHECKLIST_PATH", checklist)

    before = project_blocks.snapshot_block("adv", "1")
    item_id = before["items"][0]["item_id"]
    outcome = project_blocks.reconcile_agent_result(
        "adv",
        "1",
        before=before,
        result={
            "project_id": "adv",
            "block_id": "1",
            "items": [{
                "item_id": item_id,
                "done": True,
                "verified": True,
                "tested": True,
                "evidence": "Test PDF iPhone réussi",
                "files": ["src/pdf.ts"],
                "tests": ["test humain iPhone"],
            }],
        },
        project_root=tmp_path,
        request_id="mission-proof",
    )

    assert outcome["status"] == "completed_sync"
    assert "- [x] Verify PDF generation output" in checklist.read_text(encoding="utf-8")
    assert project_blocks.get_block("adv", "1")["pct"] == 100


def test_reconciliation_refuses_unproven_item_without_writing(tmp_path, monkeypatch):
    launch = tmp_path / "ADV_LAUNCH_BLOCKS.md"
    checklist = tmp_path / "ADV_MASTER_CHECKLIST.md"
    launch.write_text("## Block 1 — Product core\n", encoding="utf-8")
    checklist.write_text("## E. Product checks\n- [ ] Verify PDF generation output\n", encoding="utf-8")
    monkeypatch.setattr(project_blocks, "ADV_LAUNCH_BLOCKS_PATH", launch)
    monkeypatch.setattr(project_blocks, "ADV_MASTER_CHECKLIST_PATH", checklist)

    before = project_blocks.snapshot_block("adv", "1")
    outcome = project_blocks.reconcile_agent_result(
        "adv",
        "1",
        before=before,
        result={
            "project_id": "adv",
            "block_id": "1",
            "items": [{
                "item_id": before["items"][0]["item_id"],
                "done": True,
                "verified": False,
                "tested": False,
            }],
        },
        project_root=tmp_path,
        request_id="mission-no-proof",
    )

    assert outcome["status"] == "sync_failed"
    assert "- [ ] Verify PDF generation output" in checklist.read_text(encoding="utf-8")


def test_canonical_build_map_is_rescanned_and_reconciled_from_real_checkboxes(tmp_path, monkeypatch):
    build_map = tmp_path / "PROJECT_BUILD_MAP.md"
    build_map.write_text(
        "## BLOCK 01 — Test\n"
        "**STATUT GLOBAL** : `IN_PROGRESS`\n\n"
        "**CE QUI EXISTE** :\n- [x] Ancien item\n\n"
        "**CE QUI MANQUE** :\n- [ ] Item réellement terminé\n\n"
        "**RUTH_DECISION_REQUIRED** : aucune\n",
        encoding="utf-8",
    )
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "feature.py").write_text("READY = True\n", encoding="utf-8")
    monkeypatch.setitem(project_blocks.PROJECT_BUILD_MAP_PATHS, "test-project", build_map)

    before = project_blocks.snapshot_block("test-project", "01")
    missing = next(item for item in before["items"] if item["state"] == "missing")
    outcome = project_blocks.reconcile_agent_result(
        "test-project",
        "01",
        before=before,
        result={
            "project_id": "test-project",
            "block_id": "01",
            "items": [{
                "item_id": missing["item_id"],
                "done": True,
                "verified": True,
                "tested": True,
                "evidence": "Feature test passed",
                "files": ["src/feature.py"],
                "tests": ["unit test"],
            }],
        },
        project_root=tmp_path,
        request_id="mission-canonical",
    )

    assert outcome["status"] == "completed_sync"
    updated = build_map.read_text(encoding="utf-8")
    assert "- [ ] Item réellement terminé" not in updated
    assert "- [x] Item réellement terminé" in updated
    after = project_blocks.snapshot_block("test-project", "01")
    assert not [item for item in after["items"] if item["state"] == "missing"]
