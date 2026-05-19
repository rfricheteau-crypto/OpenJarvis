#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/ruthpierre/Jarvis/OpenJarvis"
HOST="127.0.0.1"
PORT="8000"
CLOUD_KEYS_FILE="/Users/ruthpierre/.openjarvis/cloud-keys.env"

cd "$PROJECT_ROOT"
if [ -f "$CLOUD_KEYS_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CLOUD_KEYS_FILE"
  set +a
fi
exec uv run jarvis serve --host "$HOST" --port "$PORT"
