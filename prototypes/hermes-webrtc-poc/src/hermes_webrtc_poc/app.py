from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import CONFIG
from .runtime import HermesWebRTCSession

app = FastAPI(title='Hermès WebRTC POC — V1 Stable', version='0.1.0')
WEB_DIR = Path(__file__).resolve().parents[2] / 'web'
app.mount('/web', StaticFiles(directory=WEB_DIR, html=True), name='web')

_sessions: dict[str, HermesWebRTCSession] = {}
_sessions_lock = asyncio.Lock()


async def _remove_session(session_id: str) -> None:
    async with _sessions_lock:
        _sessions.pop(session_id, None)


class OfferRequest(BaseModel):
    sdp: str = Field(min_length=1)
    type: str = Field(min_length=1)
    session_id: str | None = None


@app.get('/', include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url='/web/')


@app.get('/health')
async def health() -> dict[str, object]:
    async with _sessions_lock:
        active_sessions = len(_sessions)
    return {
        'ok': True,
        'phase': 'phase-1-webrtc-runtime-v1',
        'variant': 'v1-stable',
        'hermes_chat_url': CONFIG.hermes_chat_url,
        'active_sessions': active_sessions,
        'web_ui': '/web/',
        'webrtc_offer_url': '/api/offer',
    }


@app.get('/api/proto/config')
async def proto_config() -> dict[str, object]:
    return {
        'ok': True,
        'phase': 'phase-1-webrtc-runtime-v1',
        'variant': 'v1-stable',
        'hermes_chat_url': CONFIG.hermes_chat_url,
        'engine_mode': CONFIG.hermes_engine_mode,
        'strict_voice_engine': 'kokoro',
        'webrtc_offer_url': '/api/offer',
        'notes': [
            'Stable V1 voice baseline.',
            'Hermès remains the reasoning backend through /api/hermes/chat.',
            'Local voice is strict Kokoro only in this prototype.',
            'No cockpit commands or navigation in the default V1 path.',
        ],
    }


@app.get('/api/start')
async def start_config() -> dict[str, object]:
    return {
        'webrtcUrl': '/api/offer',
        'phase': 'phase-1-webrtc-runtime-v1',
        'variant': 'v1-stable',
    }


@app.post('/api/offer')
async def offer(req: OfferRequest) -> JSONResponse:
    session_id = req.session_id or f'webrtc-{uuid4().hex[:10]}'
    async with _sessions_lock:
        existing_sessions = list(_sessions.values())
        _sessions.clear()
    for existing in existing_sessions:
        await existing.close()

    async with _sessions_lock:
        session = HermesWebRTCSession(session_id=session_id, on_close=_remove_session)
        _sessions[session_id] = session

    try:
        answer = await session.initialize(req.sdp, req.type)
    except Exception as exc:
        async with _sessions_lock:
            current = _sessions.get(session_id)
            if current is session:
                _sessions.pop(session_id, None)
        await session.close()
        raise HTTPException(status_code=500, detail=f'WebRTC session init failed: {exc}') from exc

    return JSONResponse(answer)


@app.post('/api/proto/hermes/chat')
async def proto_hermes_chat_passthrough() -> JSONResponse:
    return JSONResponse(
        {
            'ok': False,
            'detail': 'Use the WebRTC flow at /web/ for Phase 1 runtime testing.',
        },
        status_code=501,
    )
