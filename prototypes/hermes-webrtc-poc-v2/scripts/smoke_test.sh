#!/usr/bin/env bash
set -euo pipefail

BASE="${HERMES_PROTO_URL:-http://127.0.0.1:8790}"

echo "[1/3] health"
curl -sS "$BASE/health"
echo

echo "[2/3] config"
curl -sS "$BASE/api/proto/config"
echo

echo "[3/3] hermes proxy"
curl -sS -X POST "$BASE/api/proto/hermes/chat" \
  -H 'Content-Type: application/json' \
  -d '{
    "message":"Bonjour Hermès, fais-moi un test très court.",
    "history":[],
    "engine_mode":"auto",
    "session_id":"hermes-webrtc-poc-v2-smoke"
  }'
echo
