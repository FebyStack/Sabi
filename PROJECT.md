# PROJECT.md — captions-clone

## What this is
Web app that auto-captions talking-head video and adds AI B-roll (generated or stock), modelled on captions.ai. Locked spec: `docs/spec.md`; architecture + evidence: `docs/blueprint.md` (full reverse-engineering report lives in `~/Desktop/Reverse Engineer/captions-ai-reverse-engineering.md`).

## Where things live (why)
- Repo lives at `~/Developer/captions-clone` on the Mac (moved from the SSD on 2026-10-18). Heavy *large* files only go to the SSD: `DATA_DIR=/Volumes/PortableSSD/Bong/captions-clone-data` holds uploads, renders and Hugging Face model weights (`HF_HOME=$DATA_DIR/hf`).
- **Never put code dependencies on the SSD**: it is ExFAT with a 1 MiB allocation block, so every small file costs 1 MiB (`node_modules` was 28 GB there; a whisperX venv + uv cache filled the drive). `node_modules`, the whisperX `.venv` (`ai/transcription/.venv`, git-ignored) and the uv cache stay on the Mac. The Mac has little free space (~5 GB on 2026-10-18): the torch-based venv is ~3 GB — check `df -h /` before `npm run ai:whisperx`. Heavy data (uploads, renders, models, Postgres/MinIO volumes) under `DATA_DIR=/Volumes/PortableSSD/Bong/captions-clone-data` — keeps the Mac's disk free.
- Ollama model blobs (large files) live on the SSD too: `npm run ai:ollama` serves with `OLLAMA_MODELS=$DATA_DIR/ollama`. Use the Ollama **CLI** (`brew install ollama`), never the menu-bar app — it autostarts its own server with models on the Mac disk.
- Hybrid architecture: `frontend/` (Vite+React+Tailwind v4), `backend/` (Express 5, `createApp(deps)` composition root), `shared/` (`contract.ts` = the only wire contract), `ai/`, `database/schema/schema.sql` (idempotent, applied on api boot), `infrastructure/docker/`.
- One root `package.json`, no workspaces. Aliases `@`, `@ai`, `@shared` exist for frontend only; backend imports stay relative.

## Run / verify
Processes (terminal tabs, or `.claude/launch.json` entries `api-lite`, `dev`, `whisperx`, `ollama`):
1. `npm run ai:whisperx` — whisperX sidecar on :8010 (first run: `uv` installs torch/whisperx into `ai/transcription/.venv` on the Mac (~3 GB), then downloads the `small` Whisper model + a wav2vec2 aligner into `DATA_DIR/hf` on the SSD).
2. `npm run dev:lite` — API with in-memory repos, files under `DATA_DIR` (debug here first); `npm run dev:server` needs `DATABASE_URL` (`make db` starts Postgres + MinIO; Docker Desktop must be running).
3. `npm run dev` — Vite on :5173 proxying `/api` → :3001.
4. `npm run ai:ollama` — Ollama on :11434 for "Plan edit" (shots, emphasis, emoji, translation). Not installed yet (2026-10-18): `brew install ollama` → `npm run ai:ollama` in its own tab → `ollama pull qwen2.5:3b` (~1.9 GB, served by that instance so it lands on the SSD). `OLLAMA_MODEL=qwen2.5:7b` (4.7 GB, fits 16 GB RAM) translates ja/ko/zh/hi/tl noticeably better, ~2× slower. Captions (`/run`) never need Ollama.
- `FAKE_AI=1 npm run dev:lite` (launch entry `api-lite-fake`) swaps whisperX **and** Ollama for fakes (sample transcript, deterministic plan, "Spanish: …" translations) so the whole UI can be driven with only ffmpeg + Chrome. Uploads from a script: `POST /api/assets/uploads/start` → `PUT /api/assets/uploads/:id` → `POST …/done` → `POST /api/projects/:id/source`.
- `npm run verify` = typecheck (web + server) + vitest (107 tests). Tests are colocated; the API is tested with supertest against `createApp(makeTestDeps())` (fake media/transcriber/renderer).
- `npm run render:sample` — real Remotion render of a 2 s clip (needs Google Chrome; ~30 s).
- Renders use the installed **Google Chrome** (`REMOTION_BROWSER_EXECUTABLE` to override): Remotion's own chrome-headless-shell never starts from the ExFAT SSD. First bundle (webpack → `.remotion-bundle/`) takes ~1 min.
- Local ffmpeg has no libass/freetype: all text is drawn by Remotion; ffmpeg only probes and extracts 16 kHz WAV, with `-protocol_whitelist file` + a format whitelist (uploads are untrusted).

## Decisions
- Commits and PRs carry **no Claude/AI co-author trailers or "Generated with Claude Code" lines** (owner's rule: they appear as GitHub contributors). `.githooks/commit-msg` strips them; `npm install` (`prepare`) sets `core.hooksPath`.
- LLM = Ollama locally (never Anthropic API — billing rule). Generation = fal.ai by default, per-project `mediaSource: "stock"` switches to Pexels only.
- Project model is JSON in Postgres (jsonb), not protobuf; render engine = Remotion/FFmpeg server-side (not in-browser WASM) for MVP.
- Shot taxonomy copied from captions.ai: `Hook | B-Roll | Talking Head | Talking Head & B-Roll`.
- Edit plan (plan 2): cuts are heuristic only (`shared/editing/cuts.ts`: ASR gap > 600 ms padded 150 ms, filler lexicon, no cuts when there is no non-filler word); the LLM only labels (shots, ≤ 2 emphasis words/phrase, emoji) and translates, always via `askJson` (zod-validated JSON, bounded arrays, one retry with the rejection fed back). Everything is stored in source time; `captionVideoProps()` maps it onto the cut timeline for both the Remotion render and the browser preview, so preview = export. Translations are independent subtitle tracks; burn-in replaces the original captions. A failed LLM step restores the previous status and keeps old outputs; a fresh `/run` or new source clears plan, translations and burn-in.

## State (2026-10-18)
Plan 1 (`docs/superpowers/plans/2026-10-18-caption-pipeline-v1.md`) merged to `main`: upload → whisperX → captions → Remotion MP4 + SRT/VTT with SSE progress, phrase/template re-render, mobile-first project page. Not yet exercised with real speech (whisperX env install pending).
Plan 2 (`docs/superpowers/plans/2026-10-18-edit-plan-and-shots.md`) implemented on branch `worktree-edit-plan-and-shots` (worktree `.claude/worktrees/edit-plan-and-shots`), **not merged**: Ollama `Llm` port (`backend/shared/llm.ts`, `FakeLlm`), `POST/GET/PATCH /api/projects/:id/plan` (job `plan`: plan → translate → render → subtitles), toggleable filler/pause cuts applied in the render, typed shots on a scrubber + per-shot list, emphasis colours, emoji row, up to 3 translated SRT/VTT tracks with optional burn-in, "Edit plan" panel. Verified: 107 tests, `npm run render:sample` (2 real renders incl. a cut timeline), browser run at 375 px with `FAKE_AI=1` (plan → seek → untick cut → re-render at full length → burn-in switch). Plan written/re-checked with Fable 5.1, implemented with Opus 5.5 (xhigh), one Fable review pass: 2 Important fixed with tests; its 7 deferred minors fixed on branch `fix/plan2-minors` (worktree `.claude/worktrees/plan2-minors`, 113 tests, not merged).
- **Unapplied DB migration:** `schema.sql` gained `source_duration_ms`, `edit_plan`, `translations`, `burn_in_language` (`ADD COLUMN IF NOT EXISTS`); they apply on the next `make db && npm run dev:server` (Docker was not running).
- **Never run against real Ollama** — first real run: install as above, then plan a short clip and watch for `llm_model_missing` / `llm_invalid_output`.
Next: merge plan 2, real-speech + real-Ollama run, then plan 3 (B-roll and overlays: B-Roll shots drive beat placement).
