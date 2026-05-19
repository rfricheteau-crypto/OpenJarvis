from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class HermesProxyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    history: list[ChatTurn] = Field(default_factory=list)
    engine_mode: Literal["auto", "economy", "quality", "local", "openai"] = "auto"
    session_id: str | None = None


class ProtoConfigResponse(BaseModel):
    ok: bool = True
    phase: str = "proto-0"
    hermes_chat_url: str
    hermes_engine_mode: str
    prebuilt_ui_available: bool
    pipecat_runtime_available: bool
    signaling_ready: bool = False
    notes: list[str]
