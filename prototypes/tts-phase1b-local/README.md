# Phase 1B — Local French TTS comparison (isolated)

This is an isolated prototype for selecting the best lightweight local French TTS for Hermès.

Scope protections:
- no Jarvis UI changes
- no cockpit changes
- no `/api/hermes/chat` changes
- no paid API usage

## Setup

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/tts-phase1b-local
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python piper-tts kokoro soundfile 'misaki[en]'
brew install espeak-ng
```

## Download Piper French voice

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/tts-phase1b-local
.venv/bin/python - <<'PY'
from huggingface_hub import hf_hub_download
from pathlib import Path
out=Path('assets/piper')
out.mkdir(parents=True, exist_ok=True)
for f in ['fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx','fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json']:
    hf_hub_download(repo_id='rhasspy/piper-voices', filename=f, local_dir=out)
PY
```

## Run benchmarks

```bash
./scripts/run_piper_fr.sh
./scripts/run_kokoro_fr.sh
./scripts/run_espeak_fr.sh
```

See final comparison table in:

- `logs/phase1b-results.md`

## Phase 1C — Warm Kokoro sidecar + Piper fallback

### Start warm sidecar

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis
scripts/start_kokoro_warm_sidecar.sh
```

This launches a persistent local sidecar on `http://127.0.0.1:8011` with:
- Primary: Kokoro (`ff_siwis`)
- Fallback: Piper (`fr_FR-siwis-medium`)
- Emergency: eSpeak NG

### Backend endpoint

`POST /api/voice/speak`

Example:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/voice/speak \
  -H 'Content-Type: application/json' \
  -d '{"text":"Bonjour Ruth, je suis Hermès. Qu’est-ce qu’on fait aujourd’hui ?","engine":"kokoro"}'
```

Response includes:
- `engine_used`: `kokoro`, `piper`, or `espeak`
- `audio_url`: local playable URL (`/api/voice/audio/<file>.wav`)

### Force fallback test (optional)

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis
OPENJARVIS_KOKORO_TIMEOUT=0.001 scripts/start_kokoro_warm_sidecar.sh
```

Then call `/api/voice/speak` with `engine=kokoro` and confirm `engine_used: piper`.

### Smoke test script

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/tts-phase1b-local
scripts/test_voice_endpoint.sh
```
