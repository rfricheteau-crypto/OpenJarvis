#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
/usr/bin/time -l .venv/bin/python scripts/run_kokoro_fr.py
