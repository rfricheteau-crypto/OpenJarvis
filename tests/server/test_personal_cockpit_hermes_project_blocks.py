from openjarvis.server import personal_cockpit as cockpit


def test_project_block_question_uses_published_pedro_state(monkeypatch):
    monkeypatch.setattr(
        cockpit,
        "_published_project_states",
        lambda: {
            "projects": [{
                "project": {"id": "pedro-os", "name": "Pedro OS"},
                "state": {"active_block": "Sécurité", "next_action": "Tester le parcours Terrain"},
            }]
        },
    )

    reply = cockpit._project_block_status_reply("Quel est le prochain bloc Pedro ?")

    assert reply == "Pour Pedro OS, le bloc actif publié est Sécurité. Prochaine action publiée : Tester le parcours Terrain."
    assert "blog" not in reply.lower()


def test_project_block_question_never_invents_missing_state(monkeypatch):
    monkeypatch.setattr(
        cockpit,
        "_published_project_states",
        lambda: {
            "projects": [{
                "project": {"id": "pedro-os", "name": "Pedro OS"},
                "state": {"active_block": "", "next_action": ""},
            }]
        },
    )

    reply = cockpit._project_block_status_reply("Quel est le prochain bloc Pedro ?")

    assert reply == "Je reconnais Pedro OS, mais aucun bloc publié n’est disponible. Je ne vais pas en inventer un."


def test_project_block_reply_does_not_duplicate_existing_punctuation(monkeypatch):
    monkeypatch.setattr(
        cockpit,
        "_published_project_states",
        lambda: {
            "projects": [{
                "project": {"id": "pedro-os", "name": "Pedro OS"},
                "state": {"active_block": "WebMCP.", "next_action": "Tester depuis ChatGPT."},
            }]
        },
    )

    reply = cockpit._project_block_status_reply("Quel est le prochain bloc Pedro ?")

    assert ".." not in reply
