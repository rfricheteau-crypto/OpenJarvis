# Hermès WebRTC POC — V2 Experimental Workspace

This folder is the isolated workspace for V2 cockpit / command / navigation experiments.

Rules:
- V1 stable baseline lives in `prototypes/hermes-webrtc-poc/`
- do not patch V1 behavior here
- do not merge V2 changes back into V1 until V1 has been revalidated
- V2 must be started on its own port and verified separately

## Goal

Rebuild V2 incrementally on top of the validated V1 vocal baseline:
- first: isolated boot and mono-voice confirmation
- then: cockpit commands
- then: true barge-in
- then only: STT command tuning

## Setup

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/hermes-webrtc-poc-v2
uv venv .venv --python 3.12
UV_CACHE_DIR=/tmp/uvcache uv pip install --python .venv/bin/python -e .
```

## Run

Start the main Jarvis backend first:

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis
scripts/start_jarvis_local_backend.sh
scripts/start_kokoro_warm_sidecar.sh
```

Then run V2:

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/hermes-webrtc-poc-v2
./scripts/start_proto.sh
```

Default URL:

- `http://127.0.0.1:8790/`

## Smoke test

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/hermes-webrtc-poc-v2
./scripts/smoke_test.sh
```
