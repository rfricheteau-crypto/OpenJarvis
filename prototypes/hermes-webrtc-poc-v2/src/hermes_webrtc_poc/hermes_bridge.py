from __future__ import annotations

import urllib.parse
from typing import Any

import httpx

from .config import CONFIG
from .models import HermesProxyRequest


class HermesBridge:
    def __init__(self) -> None:
        self._timeout = CONFIG.request_timeout_seconds

    async def chat(self, payload: HermesProxyRequest) -> dict[str, Any]:
        body = {
            'message': payload.message,
            'history': [turn.model_dump() for turn in payload.history],
            'engine_mode': payload.engine_mode,
            'session_id': payload.session_id,
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(CONFIG.hermes_chat_url, json=body)
            response.raise_for_status()
            return response.json()

    async def transcribe_wav(
        self,
        wav_bytes: bytes,
        *,
        language: str = 'fr',
        prompt: str | None = None,
    ) -> dict[str, Any]:
        files = {'file': ('recording.wav', wav_bytes, 'audio/wav')}
        data = {'language': language}
        if prompt:
            data['prompt'] = prompt
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(f'{CONFIG.hermes_base_url}/v1/speech/transcribe', files=files, data=data)
            response.raise_for_status()
            return response.json()

    async def speak_kokoro(self, text: str, speed: float = 1.08) -> tuple[dict[str, Any], bytes]:
        payload = {'text': text, 'engine': 'kokoro', 'speed': speed}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(f'{CONFIG.hermes_base_url}/api/voice/speak', json=payload)
            response.raise_for_status()
            speak_data = response.json()
            engine_used = str(speak_data.get('engine_used') or '')
            if engine_used != 'kokoro':
                raise RuntimeError(f'Strict Kokoro mode expected kokoro, got {engine_used or "unknown"}')
            audio_url = str(speak_data.get('audio_url') or '')
            if not audio_url:
                raise RuntimeError('Missing audio_url from /api/voice/speak')
            absolute_audio_url = urllib.parse.urljoin(f'{CONFIG.hermes_base_url}/', audio_url.lstrip('/'))
            audio_response = await client.get(absolute_audio_url)
            audio_response.raise_for_status()
            return speak_data, audio_response.content
