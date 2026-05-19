#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p audio

curl -L https://github.com/kyutai-labs/moshi/raw/refs/heads/main/data/sample_fr_hibiki_crepes.mp3 -o audio/sample_fr_hibiki_crepes.mp3
ffmpeg -y -i audio/sample_fr_hibiki_crepes.mp3 -t 8 -ac 1 -ar 24000 audio/sample_fr_8s_24k.wav

/usr/bin/time -l .venv/bin/python -m moshi_mlx.run_inference \
  --hf-repo kyutai/stt-1b-en_fr-mlx \
  audio/sample_fr_8s_24k.wav \
  --temp 0
