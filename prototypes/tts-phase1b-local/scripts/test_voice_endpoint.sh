#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
TEXT='Bonjour Ruth, je suis Hermès. Qu’est-ce qu’on fait aujourd’hui ?'

echo "[1/3] voice health"
curl -sS "$BACKEND_URL/api/voice/health" | jq .

echo "[2/3] speak (kokoro primary)"
RESP="$(curl -sS -X POST "$BACKEND_URL/api/voice/speak" \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"$TEXT\",\"engine\":\"kokoro\"}")"
echo "$RESP" | jq .

AUDIO_URL="$(echo "$RESP" | jq -r '.audio_url')"
if [[ "$AUDIO_URL" == "null" || -z "$AUDIO_URL" ]]; then
  echo "No audio_url in response" >&2
  exit 1
fi

echo "[3/3] download audio"
curl -sS "$BACKEND_URL$AUDIO_URL" -o /tmp/voice_phase1c_test.wav
ls -lh /tmp/voice_phase1c_test.wav
