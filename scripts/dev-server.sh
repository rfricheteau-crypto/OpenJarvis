#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/ruthpierre/Jarvis/OpenJarvis}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
RELOAD_DIR="${RELOAD_DIR:-src/openjarvis}"
HERMES_CORE_DIR="${HERMES_CORE_DIR:-/Users/ruthpierre/.openjarvis/jarvis-personal/hermes_core}"

cd "$PROJECT_ROOT"

if command -v lsof >/dev/null 2>&1 && lsof -i ":${PORT}" >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use. Stop that server once, or run with PORT=8001." >&2
  exit 1
fi

UVICORN_ARGS=(
  openjarvis.server.dev_app:create_dev_app
  --factory
  --host "$HOST"
  --port "$PORT"
  --reload
  --reload-dir "$RELOAD_DIR"
)

# `hermes_core` lives outside OpenJarvis. Watch it explicitly so a safe
# orchestration fix cannot remain stale in the long-running local server.
if [[ -d "$HERMES_CORE_DIR" ]]; then
  UVICORN_ARGS+=(--reload-dir "$HERMES_CORE_DIR")
fi

exec uv run uvicorn "${UVICORN_ARGS[@]}"
