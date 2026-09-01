from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from hermes_webrtc_poc.config import CONFIG
from hermes_webrtc_poc.hermes_bridge import HermesBridge
from hermes_webrtc_poc.hermes_bridge import _safe_kokoro_speed
from hermes_webrtc_poc.models import ChatTurn, HermesProxyRequest


class _Response:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, str]:
        return {"reply": "Bonjour Ruth"}


class _Client:
    def __init__(self) -> None:
        self.url = ""
        self.payload: dict[str, object] = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url: str, *, json: dict[str, object]):
        self.url = url
        self.payload = json
        return _Response()


class HermesBridgeTests(unittest.TestCase):
    def test_kokoro_speed_is_kept_within_the_voice_api_contract(self) -> None:
        self.assertEqual(_safe_kokoro_speed(1.28), 1.25)
        self.assertEqual(_safe_kokoro_speed(0.5), 0.85)
        self.assertEqual(_safe_kokoro_speed(1.1), 1.1)

    def test_chat_uses_g_route_and_preserves_session_context(self) -> None:
        client = _Client()
        with patch("hermes_webrtc_poc.hermes_bridge.httpx.AsyncClient", return_value=client):
            result = asyncio.run(
                HermesBridge().chat(
                    HermesProxyRequest(
                        message="Où en est Pedro ?",
                        history=[ChatTurn(role="assistant", content="Bonjour")],
                        engine_mode="economy",
                        session_id="shared-session-42",
                    )
                )
            )

        self.assertEqual(client.url, CONFIG.hermes_chat_url)
        self.assertTrue(client.url.endswith("/api/hermes/chat"))
        self.assertEqual(client.payload["session_id"], "shared-session-42")
        self.assertEqual(client.payload["history"], [{"role": "assistant", "content": "Bonjour"}])
        self.assertEqual(result["reply"], "Bonjour Ruth")
