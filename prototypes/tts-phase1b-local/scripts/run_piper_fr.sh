#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

/usr/bin/time -l .venv/bin/python -m piper \
  --model assets/piper/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx \
  --config assets/piper/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json \
  --input-file assets/test_sentence_fr.txt \
  --output-file audio/piper_fr.wav
