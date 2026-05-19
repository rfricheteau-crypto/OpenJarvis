# Hermès WebRTC POC — V1 Stable Baseline

Isolated prototype for a real continuous voice conversation loop using Pipecat SmallWebRTC.

This prototype is intentionally separate from the current Jarvis UI.

Status:
- this folder is the V1 stable vocal baseline
- no cockpit navigation
- no local voice commands
- no experimental V2 behavior in the default path

Scope protections:
- no cockpit change
- no `/api/hermes/chat` change
- no Obsidian bridge change
- no production UI integration yet

## Goal

Build a safer path toward:
- browser WebRTC voice input/output
- visible transcription
- one stable voice path
- a real continuous conversation loop
- Hermès kept as the reasoning backend

## Why this prototype exists

The current browser stack in `JarvisPersonalPage.tsx` is patchable for manual turns, but it is not yet a trustworthy basis for real continuous conversation.

This POC follows the official Pipecat SmallWebRTC path:
- Pipecat client transport docs: https://docs.pipecat.ai/client/js/transports/small-webrtc
- Pipecat server transport docs: https://docs.pipecat.ai/server/services/transport/small-webrtc
- Pipecat transport guidance: https://docs.pipecat.ai/client/concepts/choosing-a-transport

## V1 delivered here

This prototype now provides:
- isolated FastAPI app
- custom browser UI at `/web/`
- real Pipecat `SmallWebRTCConnection` + `SmallWebRTCTransport`
- local VAD-driven audio capture in the WebRTC pipeline
- strict Hermès HTTP bridge to existing `http://127.0.0.1:8000/api/hermes/chat`
- strict Kokoro-only TTS bridge through existing `/api/voice/speak`
- visible browser state, event log, transcription, and replies
- zero impact on main OpenJarvis runtime

What it still does **not** guarantee yet:
- product validation of 2-turn continuous conversation by Ruth
- barge-in / interruption policy
- production integration into the current Jarvis page
- hardening against all runtime edge cases

## V2 policy

The V2 cockpit/commands/navigation experiments must live separately from this V1 baseline.

If V2 work resumes:
- do not modify this V1 path first
- build or patch V2 in a separate workspace
- revalidate V1 after every V2 change

## Files

- `src/hermes_webrtc_poc/app.py`: isolated FastAPI app and offer route
- `src/hermes_webrtc_poc/runtime.py`: Pipecat WebRTC runtime and Hermès turn processor
- `src/hermes_webrtc_poc/hermes_bridge.py`: proxy to existing Hermès backend
- `src/hermes_webrtc_poc/audio_utils.py`: PCM/WAV conversion helpers
- `src/hermes_webrtc_poc/config.py`: env-driven config
- `src/hermes_webrtc_poc/models.py`: request/response models
- `web/`: isolated browser client
- `scripts/start_proto.sh`: start the isolated prototype server
- `scripts/smoke_test.sh`: basic endpoint smoke test

## Setup

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/hermes-webrtc-poc
uv venv .venv --python 3.12
UV_CACHE_DIR=/tmp/uvcache uv pip install --python .venv/bin/python -e .
```

## Run

Start the existing Hermès backend separately first:

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis
scripts/start_jarvis_local_backend.sh
```

Then start the isolated prototype:

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/hermes-webrtc-poc
./scripts/start_proto.sh
```

The script runs without `--reload` by default for a more stable voice test.
If you explicitly want autoreload:

```bash
HERMES_PROTO_RELOAD=1 ./scripts/start_proto.sh
```

Default URL:

- `http://127.0.0.1:8788/`

## Useful endpoints

- `GET /health`
- `GET /api/proto/config`
- `GET /web/`
- `GET /api/start`
- `POST /api/offer`

## Smoke test

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/hermes-webrtc-poc
./scripts/smoke_test.sh
```

## Environment

Optional overrides:

```bash
export HERMES_PROTO_HOST=127.0.0.1
export HERMES_PROTO_PORT=8788
export HERMES_BASE_URL=http://127.0.0.1:8000
export HERMES_CHAT_PATH=/api/hermes/chat
export HERMES_ENGINE_MODE=auto
```

## Current validation target (V1)

The current Phase 1 target is:
- open `http://127.0.0.1:8788/web/`
- click once to connect
- hear the greeting through WebRTC
- speak one phrase
- see the transcription
- see Hermès reply
- hear the Kokoro reply through the remote audio track

Do not treat this as validated until Ruth confirms the real browser flow.
