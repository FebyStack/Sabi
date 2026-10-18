# Locked Spec (confirmed 2026-10-18)

Changes to this list go here first, then into code — never absorbed silently.

| # | Decision | Locked value |
|---|---|---|
| 1 | Platforms | **Desktop + mobile web editing.** Full timeline editing must work on phones (touch drag/pinch), not just upload/review. Overrides §10.6 desktop-first. |
| 2 | Privacy | Uploads, proxies, generated media and renders auto-delete **30 days** after last access; cookie/analytics **consent banner** (decline = no analytics); EXIF stripped on upload; no third-party session replay. |
| 3 | Roles | **Solo users only** for MVP: one account = one workspace, no sharing/orgs. Schema keeps `orgId` nullable so orgs can be added later. |
| 4 | Outputs | **MP4 (HD 1080p + 4K) with burned-in captions and overlays, plus SRT and VTT sidecars.** No alpha overlay export, no project JSON export in MVP. |
| 5 | States | **First-run demo project** (pre-rendered sample with captions + B-roll) + **staged progress** (uploading → transcribing → planning → generating → rendering, with %), empty-state CTAs on Projects/Timeline/B-roll panels; no coach-mark tour. |
| 6 | Integration | **Standalone new project** in Febriel's hybrid architecture (React+Vite / Node+Express / Postgres / Docker), own S3-compatible storage (MinIO dev, R2/S3 prod). No Supabase, no existing site. |
| 7 | Providers | **Self-hosted ASR + LLM on Febriel's Apple-Silicon Mac**: `whisperX` (word timestamps + alignment, multi-language) and `Ollama` (planner, emphasis tagging, translation, chat agent). **No Anthropic API.** Generation is **hybrid**: `fal.ai` for images (Flux) and video clips (Kling/Hailuo) as the default, **Pexels stock** always available; each project has a user-facing **Media source** setting: `Generate (fal.ai)` or `Stock only`. |
| 8 | Coverage | All four: (a) English captions with word-level karaoke, AI emphasis (nouns/keywords/pictorial), auto emoji; (b) multi-language transcription + translated subtitle tracks; (c) filler/pause recommended cuts + typed shots `Hook / B-Roll / Talking Head / Talking Head & B-Roll`; (d) generated image **and** video B-roll + chat-to-edit agent (tool loop: inspect → generate → apply_actions → render_frame verify). |
| 9 | Monetization | Not decided; MVP has **no billing** — a per-user credit ledger is logged (fal.ai cost per generation) so a credit model can be switched on later. |

Blueprint impacts: §10.2 Timeline must be touch-first (pointer events, 44 px targets, pinch-zoom); §10.3 steps 2/3 run as local workers (whisperX via Python sidecar, Ollama HTTP) with hosted fal.ai only in step 5; §10.12 adds a `worker-ai` container profile that targets the Mac host (Metal) in dev and a GPU VPS in prod; §10.3 step 8 (agent) is in MVP scope.
