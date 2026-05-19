#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSM="$ROOT/vendor/delayed-streams-modeling"

cd "$DSM"

if [[ ! -f "$ROOT/assets/tts_input_fr_short.txt" ]]; then
  printf "Bonjour Ruth." > "$ROOT/assets/tts_input_fr_short.txt"
fi

/usr/bin/time -l "$ROOT/.venv/bin/python" scripts/tts_mlx.py \
  "$ROOT/assets/tts_input_fr_short.txt" \
  "$ROOT/audio/tts_fr_short.wav" \
  --quantize 8 \
  --voice cml-tts/fr/1406_1028_000009-0003.wav
