# PROJECT.md — captions-clone

## What this is
Web app that auto-captions talking-head video and adds AI B-roll (generated or stock), modelled on captions.ai. Locked spec: `docs/spec.md`; architecture + evidence: `docs/blueprint.md` (full reverse-engineering report lives in `~/Desktop/Reverse Engineer/captions-ai-reverse-engineering.md`).

## Where things live (why)
- Repo on the external SSD `/Volumes/PortableSSD/Bong/captions-clone` (ExFAT: no file perms/hard links, `git config core.filemode false`). macOS litters `._*` AppleDouble files beside every source file — they are git-ignored and excluded in vitest/tsconfig; run `dot_clean -m .` if a tool still trips on one. Heavy data (uploads, renders, models, Postgres/MinIO volumes) under `DATA_DIR=/Volumes/PortableSSD/Bong/captions-clone-data` — keeps the Mac's disk free.
- Hybrid architecture: `frontend/` (Vite+React+Tailwind v4), `backend/` (Express 5, `createApp(deps)` composition root), `shared/` (`contract.ts` = the only wire contract), `ai/`, `database/schema/schema.sql` (idempotent, applied on api boot), `infrastructure/docker/`.
- One root `package.json`, no workspaces. Aliases `@`, `@ai`, `@shared` exist for frontend only; backend imports stay relative.

## Run / verify
- `npm run dev:lite` → API with in-memory repos, zero infra (debug here first). `npm run dev` → Vite on :5173 proxying `/api` → :3001. `npm run dev:server` needs `DATABASE_URL`.
- `npm run verify` = typecheck (web + server) + vitest. Tests are colocated (`backend/app/app.test.ts` uses supertest against `createApp(makeTestDeps())`).
- `make db` starts Postgres + MinIO via compose (Docker Desktop must be running); `make up` builds api + web images.
- AI workers (whisperX, Ollama) run on the Mac host, not in Docker; compose points at `host.docker.internal`. Ollama is not installed yet.

## Decisions
- LLM = Ollama locally (never Anthropic API — billing rule). Generation = fal.ai by default, per-project `mediaSource: "stock"` switches to Pexels only.
- Project model is JSON in Postgres (jsonb), not protobuf; render engine = Remotion/FFmpeg server-side (not in-browser WASM) for MVP.
- Shot taxonomy copied from captions.ai: `Hook | B-Roll | Talking Head | Talking Head & B-Roll`.

## State (2026-10-18)
Scaffold committed (`4a5a9f8`): health + projects CRUD (memory + pg repos), frontend list/create, docker compose, schema. Plans: `docs/superpowers/plans/README.md` (5-plan sequence); plan 1 `2026-10-18-caption-pipeline-v1.md` (upload → whisperX → captions → Remotion MP4 + SRT/VTT) written, not started. Local ffmpeg has no libass/freetype — text rendering is Remotion only.
