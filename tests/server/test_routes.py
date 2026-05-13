"""Tests for the API server routes."""

from __future__ import annotations

import json
import os
import sys
import types
from unittest.mock import MagicMock

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from openjarvis.server.app import create_app  # noqa: E402
from openjarvis.server import routes as server_routes  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_engine(content="Hello from server", models=None):
    engine = MagicMock()
    engine.engine_id = "mock"
    engine.health.return_value = True
    engine.list_models.return_value = models or ["test-model"]
    engine.generate.return_value = {
        "content": content,
        "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
        "model": "test-model",
        "finish_reason": "stop",
    }

    # Set up async stream
    async def mock_stream(
        messages,
        *,
        model,
        temperature=0.7,
        max_tokens=1024,
        **kwargs,
    ):
        for token in ["Hello", " ", "world"]:
            yield token

    engine.stream = mock_stream
    return engine


def _make_agent(content="Hello from agent"):
    from openjarvis.agents._stubs import AgentResult

    agent = MagicMock()
    agent.agent_id = "mock"
    agent.run.return_value = AgentResult(content=content, turns=1)
    return agent


@pytest.fixture
def client():
    engine = _make_engine()
    app = create_app(engine, "test-model")
    return TestClient(app)


@pytest.fixture
def client_with_agent():
    engine = _make_engine()
    agent = _make_agent()
    app = create_app(engine, "test-model", agent=agent)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Chat completions tests
# ---------------------------------------------------------------------------


class TestChatCompletions:
    def test_basic_completion(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["object"] == "chat.completion"
        assert data["choices"][0]["message"]["content"] == "Hello from server"

    def test_completion_has_usage(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )
        data = resp.json()
        assert data["usage"]["total_tokens"] == 8

    def test_completion_has_id(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )
        data = resp.json()
        assert data["id"].startswith("chatcmpl-")

    def test_custom_temperature(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
                "temperature": 0.1,
            },
        )
        assert resp.status_code == 200

    def test_with_system_message(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [
                    {"role": "system", "content": "Be helpful"},
                    {"role": "user", "content": "Hello"},
                ],
            },
        )
        assert resp.status_code == 200

    def test_with_tools(self):
        engine = _make_engine()
        engine.generate.return_value = {
            "content": "",
            "tool_calls": [
                {"id": "c1", "name": "calc", "arguments": '{"expr":"2+2"}'},
            ],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
            "model": "test-model",
            "finish_reason": "tool_calls",
        }
        app = create_app(engine, "test-model")
        client = TestClient(app)
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Calc"}],
                "tools": [{"type": "function", "function": {"name": "calc"}}],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["choices"][0]["message"]["tool_calls"] is not None

    def test_agent_mode(self, client_with_agent):
        resp = client_with_agent.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["choices"][0]["message"]["content"] == "Hello from agent"

    def test_agent_with_conversation(self, client_with_agent):
        resp = client_with_agent.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [
                    {"role": "system", "content": "Be helpful"},
                    {"role": "user", "content": "Hello"},
                ],
            },
        )
        assert resp.status_code == 200

    def test_streaming(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": True,
            },
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        # Parse SSE events
        lines = resp.text.strip().split("\n")
        data_lines = [ln for ln in lines if ln.startswith("data:")]
        assert len(data_lines) > 0
        # Last should be [DONE]
        assert data_lines[-1].strip() == "data: [DONE]"

    def test_streaming_content(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": True,
            },
        )
        # Collect content tokens from stream
        content = ""
        for line in resp.text.strip().split("\n"):
            if line.startswith("data:") and "[DONE]" not in line:
                data = json.loads(line[5:].strip())
                choices = data.get("choices", [{}])
                delta_content = (
                    choices[0]
                    .get(
                        "delta",
                        {},
                    )
                    .get("content")
                )
                if delta_content:
                    content += delta_content
        assert content == "Hello world"

    def test_finish_reason_default(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "test-model",
                "messages": [{"role": "user", "content": "Hello"}],
            },
        )
        data = resp.json()
        assert data["choices"][0]["finish_reason"] == "stop"


# ---------------------------------------------------------------------------
# Models endpoint tests
# ---------------------------------------------------------------------------


class TestModelsEndpoint:
    def test_list_models(self, client):
        resp = client.get("/v1/models")
        assert resp.status_code == 200
        data = resp.json()
        assert data["object"] == "list"
        assert len(data["data"]) == 1
        assert data["data"][0]["id"] == "test-model"

    def test_model_object_format(self, client):
        resp = client.get("/v1/models")
        data = resp.json()
        model = data["data"][0]
        assert model["object"] == "model"
        assert "owned_by" in model

    def test_multiple_models(self):
        engine = _make_engine(models=["model-a", "model-b", "model-c"])
        app = create_app(engine, "model-a")
        client = TestClient(app)
        resp = client.get("/v1/models")
        data = resp.json()
        assert len(data["data"]) == 3


# ---------------------------------------------------------------------------
# Health endpoint tests
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    def test_healthy(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_unhealthy(self):
        engine = _make_engine()
        engine.health.return_value = False
        app = create_app(engine, "test-model")
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# App creation tests
# ---------------------------------------------------------------------------


class TestCreateApp:
    def test_app_state(self):
        engine = _make_engine()
        app = create_app(engine, "test-model")
        assert app.state.engine is engine
        assert app.state.model == "test-model"

    def test_app_with_agent(self):
        engine = _make_engine()
        agent = _make_agent()
        app = create_app(engine, "test-model", agent=agent)
        assert app.state.agent is agent

    def test_app_without_agent(self):
        engine = _make_engine()
        app = create_app(engine, "test-model")
        assert app.state.agent is None


class _FakeCloudEngine:
    def health(self):
        return True


class _FakeMultiEngine:
    def __init__(self, engines):
        self._engines = list(engines)
        self.refreshed = False

    def _refresh_map(self):
        self.refreshed = True


class TestCloudKeyRoutes:
    def _install_fake_cloud_modules(self, monkeypatch):
        fake_cloud_module = types.ModuleType("openjarvis.engine.cloud")
        fake_cloud_module.CloudEngine = _FakeCloudEngine
        fake_multi_module = types.ModuleType("openjarvis.engine.multi")
        fake_multi_module.MultiEngine = _FakeMultiEngine
        monkeypatch.setitem(sys.modules, "openjarvis.engine.cloud", fake_cloud_module)
        monkeypatch.setitem(sys.modules, "openjarvis.engine.multi", fake_multi_module)

    def test_save_cloud_keys_preserves_comments_and_reloads_engine(self, tmp_path, monkeypatch):
        self._install_fake_cloud_modules(monkeypatch)
        keys_path = tmp_path / "cloud-keys.env"
        keys_path.write_text(
            "# cloud keys\nKEEP_ME=1\nOPENAI_API_KEY=old-openai\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(server_routes, "_CLOUD_KEYS_FILE", keys_path)

        engine = _make_engine()
        app = create_app(engine, "test-model", engine_name="mock")
        client = TestClient(app)

        resp = client.post(
            "/v1/cloud/keys",
            json={
                "OPENAI_API_KEY": "new-openai",
                "ANTHROPIC_API_KEY": "anthropic-secret",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert sorted(data["saved"]) == ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]
        assert "OPENAI_API_KEY" in data["configured_keys"]
        assert "ANTHROPIC_API_KEY" in data["configured_keys"]
        assert os.environ["OPENAI_API_KEY"] == "new-openai"
        assert os.environ["ANTHROPIC_API_KEY"] == "anthropic-secret"

        content = keys_path.read_text(encoding="utf-8")
        assert "# cloud keys" in content
        assert "KEEP_ME=1" in content
        assert "OPENAI_API_KEY=new-openai" in content
        assert "ANTHROPIC_API_KEY=anthropic-secret" in content
        assert "old-openai" not in content

    def test_save_cloud_keys_empty_string_clears_key_and_env(self, tmp_path, monkeypatch):
        self._install_fake_cloud_modules(monkeypatch)
        keys_path = tmp_path / "cloud-keys.env"
        keys_path.write_text(
            "OPENAI_API_KEY=to-remove\nGEMINI_API_KEY=keep-me\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(server_routes, "_CLOUD_KEYS_FILE", keys_path)
        monkeypatch.setenv("OPENAI_API_KEY", "to-remove")
        monkeypatch.setenv("GEMINI_API_KEY", "keep-me")

        engine = _make_engine()
        app = create_app(engine, "test-model", engine_name="mock")
        client = TestClient(app)

        resp = client.post("/v1/cloud/keys", json={"OPENAI_API_KEY": ""})

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "OPENAI_API_KEY" not in data["configured_keys"]
        assert "GEMINI_API_KEY" in data["configured_keys"]
        assert "OPENAI_API_KEY" not in os.environ
        assert os.environ["GEMINI_API_KEY"] == "keep-me"

        content = keys_path.read_text(encoding="utf-8")
        assert "OPENAI_API_KEY" not in content
        assert "GEMINI_API_KEY=keep-me" in content

    def test_reload_cloud_route_clears_missing_allowed_keys(self, tmp_path, monkeypatch):
        self._install_fake_cloud_modules(monkeypatch)
        keys_path = tmp_path / "cloud-keys.env"
        keys_path.write_text("OPENROUTER_API_KEY=router-key\n", encoding="utf-8")
        monkeypatch.setattr(server_routes, "_CLOUD_KEYS_FILE", keys_path)
        monkeypatch.setenv("OPENAI_API_KEY", "stale-openai")

        engine = _make_engine()
        app = create_app(engine, "test-model", engine_name="mock")
        client = TestClient(app)

        resp = client.post("/v1/cloud/reload")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["configured_keys"] == ["OPENROUTER_API_KEY"]
        assert "OPENAI_API_KEY" not in os.environ
        assert os.environ["OPENROUTER_API_KEY"] == "router-key"
