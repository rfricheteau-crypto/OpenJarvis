#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/ruthpierre/Jarvis/OpenJarvis/frontend"
HOST="127.0.0.1"
PORT="5173"

cd "$PROJECT_ROOT"
exec npm run dev -- --host "$HOST" --port "$PORT"
