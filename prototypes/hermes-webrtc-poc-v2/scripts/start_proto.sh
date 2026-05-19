#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -x .venv/bin/python ]]; then
  echo "Missing virtualenv. Run: uv venv .venv --python 3.12"
  exit 1
fi

UVICORN_ARGS=(
  -m uvicorn hermes_webrtc_poc.app:app
  --app-dir "$ROOT/src"
  --host "${HERMES_PROTO_HOST:-127.0.0.1}"
  --port "${HERMES_PROTO_PORT:-8790}"
)

if [[ "${HERMES_PROTO_RELOAD:-0}" == "1" ]]; then
  UVICORN_ARGS+=(--reload)
fi

exec .venv/bin/python "${UVICORN_ARGS[@]}"
