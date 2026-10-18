# whisperX sidecar

Runs on the Mac host (CPU, int8). First start downloads the Whisper `small` model (~500 MB) and a wav2vec2 alignment model per language into `~/.cache`; set `HF_HOME`/`XDG_CACHE_HOME` to a folder on the SSD to keep them off the Mac disk.

```bash
npm run ai:whisperx            # uv run --project ai/transcription uvicorn server:app --port 8010
curl -F file=@audio.wav localhost:8010/transcribe
```

Env: `WHISPERX_MODEL` (small|medium|large-v3), `WHISPERX_DEVICE` (cpu), `WHISPERX_COMPUTE` (int8|float32). Input must be 16 kHz mono WAV (the API extracts it with ffmpeg).
