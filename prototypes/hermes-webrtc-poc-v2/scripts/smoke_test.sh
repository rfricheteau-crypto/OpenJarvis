#!/usr/bin/env bash
set -euo pipefail

BASE="${HERMES_PROTO_URL:-http://127.0.0.1:8790}"

echo "[1/3] health"
curl --fail-with-body -sS "$BASE/health"
echo

echo "[2/3] config"
curl --fail-with-body -sS "$BASE/api/proto/config"
echo

echo "[3/3] WebRTC page"
curl --fail-with-body -sS "$BASE/web/" >/dev/null
echo

echo "OK — POC WebRTC démarré. Ce smoke ne valide pas le micro, STT, TTS ni le barge-in."
