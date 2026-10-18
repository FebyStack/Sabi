# PROJECT.md — captions-clone

## What this is
Web app that auto-captions talking-head video and adds AI B-roll (generated or stock), modelled on captions.ai. Locked spec: `docs/spec.md`; architecture + evidence: `docs/blueprint.md` (full reverse-engineering report lives in `~/Desktop/Reverse Engineer/captions-ai-reverse-engineering.md`).

## Where things live (why)
- Repo lives at `~/Developer/captions-clone` on the Mac (moved from the SSD on 2026-10-18). Heavy *large* files only go to the SSD: `DATA_DIR=/Volumes/PortableSSD/Bong/captions-clone-data` holds uploads, renders and Hugging Face model weights (`HF_HOME=$DATA_DIR/hf`).
- **Never put code dependencies on the SSD**: it is ExFAT with a 1 MiB allocation block, so every small file costs 1 MiB (`node_modules` was 28 GB there; a whisperX venv + uv cache filled the drive). `node_modules`, the whisperX `.venv` (`ai/transcription/.venv`, git-ignored) and the uv cache stay on the Mac. The Mac has little free space (~5 GB on 2026-10-18): the torch-based venv is ~3 GB — check `df -h /` before `npm run ai:whisperx`. Heavy data (uploads, renders, models, Postgres/MinIO volumes) under `DATA_DIR=/Volumes/PortableSSD/Bong/captions-clone-data` — keeps the Mac's disk free.
- Hybrid architecture: `frontend/` (Vite+React+Tailwind v4), `backend/` (Express 5, `createApp(deps)` composition root), `shared/` (`contract.ts` = the only wire contract), `ai/`, `database/schema/schema.sql` (idempotent, applied on api boot), `infrastructure/docker/`.
- One root `package.json`, no workspaces. Aliases `@`, `@ai`, `@shared` exist for frontend only; backend imports stay relative.

## Run / verify
Three processes for the caption pipeline (three terminal tabs, or `.claude/launch.json` entries `api-lite`, `dev`, `whisperx`):
1. `npm run ai:whisperx` — whisperX sidecar on :8010 (first run: `uv` installs torch/whisperx into `ai/transcription/.venv` on the Mac (~3 GB), then downloads the `small` Whisper model + a wav2vec2 aligner into `DATA_DIR/hf` on the SSD).
2. `npm run dev:lite` — API with in-memory repos, files under `DATA_DIR` (debug here first); `npm run dev:server` needs `DATABASE_URL` (`make db` starts Postgres + MinIO; Docker Desktop must be running).
3. `npm run dev` — Vite on :5173 proxying `/api` → :3001.
- `npm run verify` = typecheck (web + server) + vitest (37 tests). Tests are colocated; the API is tested with supertest against `createApp(makeTestDeps())` (fake media/transcriber/renderer).
- `npm run render:sample` — real Remotion render of a 2 s clip (needs Google Chrome; ~30 s).
- Renders use the installed **Google Chrome** (`REMOTION_BROWSER_EXECUTABLE` to override): Remotion's own chrome-headless-shell never starts from the ExFAT SSD. First bundle (webpack → `.remotion-bundle/`) takes ~1 min.
- Local ffmpeg has no libass/freetype: all text is drawn by Remotion; ffmpeg only probes and extracts 16 kHz WAV, with `-protocol_whitelist file` + a format whitelist (uploads are untrusted).

## Decisions
- LLM = Ollama locally (never Anthropic API — billing rule). Generation = fal.ai by default, per-project `mediaSource: "stock"` switches to Pexels only.
- Project model is JSON in Postgres (jsonb), not protobuf; render engine = Remotion/FFmpeg server-side (not in-browser WASM) for MVP.
- Shot taxonomy copied from captions.ai: `Hook | B-Roll | Talking Head | Talking Head & B-Roll`.

## State (2026-10-18)
Plan 1 (`docs/superpowers/plans/2026-10-18-caption-pipeline-v1.md`) implemented on branch `feat/caption-pipeline-v1`: upload (streamed to `DATA_DIR/uploads`) → ffprobe → `/source` → `/run` job (extract-audio → whisperX → segment → Remotion render → SRT/VTT) with SSE progress, phrase/template re-render, mobile-first project page. Verified: 54 unit/API tests, real Remotion render (~30 s with installed Chrome), browser check of upload → run → failure state. Final review (fresh reviewer) → 10 Critical/Important findings fixed with tests (`5650828`); 25 minors deferred, listed in `.superpowers/sdd/…/progress.md` and the session summary. **Not yet exercised end to end with real speech** — the whisperX env install (`uv sync`) is slow on the SSD; run `npm run ai:whisperx` alone, then upload `test-clip-9x16.mp4`. Next: plan 2 (Ollama edit plan, shots, emphasis, emoji, translation).
