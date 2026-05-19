#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/ruthpierre/Jarvis/OpenJarvis}"
SIDECAR_ROOT="${SIDECAR_ROOT:-$PROJECT_ROOT/prototypes/tts-phase1b-local}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8011}"

PYTHON_BIN="$SIDECAR_ROOT/.venv/bin/python"
APP_DIR="$SIDECAR_ROOT/sidecar"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing sidecar venv python: $PYTHON_BIN" >&2
  echo "Run Phase 1B setup first." >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -i ":${PORT}" >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use." >&2
  exit 1
fi

export OPENJARVIS_VOICE_SIDECAR_URL="http://${HOST}:${PORT}"

exec "$PYTHON_BIN" -m uvicorn \
  voice_sidecar_app:create_voice_sidecar_app \
  --factory \
  --app-dir "$APP_DIR" \
  --host "$HOST" \
  --port "$PORT"
