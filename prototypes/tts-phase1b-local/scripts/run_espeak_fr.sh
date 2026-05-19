#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
/usr/bin/time -l espeak-ng -v fr-fr -s 165 -w audio/espeak_fr.wav -f assets/test_sentence_fr.txt
