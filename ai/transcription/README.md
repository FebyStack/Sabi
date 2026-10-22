# whisperX sidecar

Runs on the Mac host (CPU, int8). First start downloads the Whisper `small` model (~500 MB) and a wav2vec2 alignment model per language into `~/.cache`; set `HF_HOME`/`XDG_CACHE_HOME` to a folder on the SSD to keep them off the Mac disk (`npm run ai:whisperx` does).

```bash
npm run ai:whisperx            # uv run --directory ai/transcription uvicorn server:app --port 8010
curl -F file=@audio.wav localhost:8010/transcribe
```

Env: `WHISPERX_MODEL` (small|medium|large-v3), `WHISPERX_DEVICE` (cpu), `WHISPERX_COMPUTE` (int8|float32). Input must be 16 kHz mono WAV (the API extracts it with ffmpeg).

Response: `{"language", "words": [{"text", "start", "end", "score"?}], "estimated_words"}` (seconds).

- **Tagalog:** whisperX ≥ 3.8.6 ships a default `tl` aligner (`Khalsuu/filipino-wav2vec2-l-xls-r-300m-official`, 1.26 GB), downloaded into `HF_HOME` on the first Tagalog clip. Its vocabulary is Latin a–z, so the English words in Taglish align too.
- **Estimated timing:** words are never dropped. A segment whisperX fails to align, a word it leaves untimed, or a language with no aligner at all (`aligner()` returns `None` and retries on the next request) gets timings spread over its segment by character length (`timing.py`). Those words carry no `score`; `estimated_words` counts them, and the API turns a non-zero count into the project warning `timing_estimated`.
- **Tests:** `npm run test:py` runs `test_timing.py` with an ephemeral pytest (`uv run --no-project --with pytest`); it needs only `uv`, not the venv or torch.
