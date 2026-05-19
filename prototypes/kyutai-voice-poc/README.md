# Kyutai Voice POC (Phase 1, isolated)

This folder is an isolated local prototype for Ruth OS voice feasibility testing.

Scope:
- No change to OpenJarvis UI.
- No change to cockpit.
- No change to `/api/hermes/chat`.
- No removal of browser voice fallback.

## Environment tested

- Machine: Apple M1, 8 GB RAM
- OS: macOS 26.3.1
- Python (POC venv): 3.12.13
- `moshi_mlx`: 0.3.0

## What was tested

1. STT with MLX + Kyutai model `kyutai/stt-1b-en_fr-mlx`.
2. TTS with MLX + Kyutai model `kyutai/tts-1.6b-en_fr` and french voice embeddings from `kyutai/tts-voices`.

## Quick start

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/kyutai-voice-poc
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python moshi_mlx
mkdir -p vendor
git clone https://github.com/kyutai-labs/delayed-streams-modeling.git vendor/delayed-streams-modeling
```

### STT test (validated)

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/kyutai-voice-poc
curl -L https://github.com/kyutai-labs/moshi/raw/refs/heads/main/data/sample_fr_hibiki_crepes.mp3 -o audio/sample_fr_hibiki_crepes.mp3
ffmpeg -y -i audio/sample_fr_hibiki_crepes.mp3 -t 8 -ac 1 -ar 24000 audio/sample_fr_8s_24k.wav
/usr/bin/time -l .venv/bin/python -m moshi_mlx.run_inference --hf-repo kyutai/stt-1b-en_fr-mlx audio/sample_fr_8s_24k.wav --temp 0
```

Observed output transcript:
- `Bonjour, aujourd'hui, nous allons préparer des crêpes.`

Observed performance:
- Real time: `94.31s` for 8s audio (first run with model loading/warmup)
- `maximum resident set size`: `1282359296`
- `peak memory footprint`: `2587941760`

### TTS test (heavy / degraded)

```bash
cd /Users/ruthpierre/Jarvis/OpenJarvis/prototypes/kyutai-voice-poc/vendor/delayed-streams-modeling
printf "Bonjour Ruth." > ../../assets/tts_input_fr_short.txt
/usr/bin/time -l ../../.venv/bin/python scripts/tts_mlx.py ../../assets/tts_input_fr_short.txt ../../audio/tts_fr_short.wav --quantize 8 --voice cml-tts/fr/1406_1028_000009-0003.wav
```

Observed behavior on this machine:
- Model and voice assets download succeeded (`kyutai/tts-1.6b-en_fr` + `kyutai/tts-voices`).
- Inference loop started and generated frames (`generated 0.08s ... generated 0.48s`) in long run.
- But generation speed was too slow for practical usage on M1 8GB.
- No final WAV was produced in a reasonable time window for the short prompt (run aborted after extended stall/slow progress).

## Feasibility conclusion (Phase 1)

- STT (Kyutai MLX) on this Mac: **works**.
- TTS (Kyutai MLX 1.6b) on this Mac: **technically starts but not practically usable** with current latency/memory profile.
- For a real voice-first UX on this hardware, Phase 2 should only proceed if we accept:
  - STT local Kyutai + alternative lighter TTS path, or
  - stronger hardware for full local Kyutai TTS experience.

## Files

- `scripts/run_stt_mlx.sh`: reproducible STT benchmark command.
- `scripts/run_tts_mlx.sh`: reproducible TTS benchmark command.
- `assets/tts_input_fr_short.txt`: short french TTS prompt used in benchmark.

