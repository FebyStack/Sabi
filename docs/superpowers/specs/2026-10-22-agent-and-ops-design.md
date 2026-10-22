# Plan 5 — agent and ops: design (2026-10-22)

Spec rows **19–23** (`docs/spec.md`) hold the locked decisions; this document is the how. The owner answered the scoping batch with "all defaults" on 2026-10-22. Builder: Opus 5.5, inline. Base: branch `claude/agent-and-ops`, cut from `claude/tagalog-pipeline` (PR #6), because plan 5 rewrites the pipeline's file handling and the job runner, which #6 also touches.

## Intent

Sabi is a personal tool on Febriel's Mac. Claude (over the `sabi` MCP server) is the editor. Plan 5 closes the agent's last gap and makes the backend run as a real service:

1. The agent can **make one asset on demand** (a fal image or video from a prompt, or Pexels candidates for a query) and **place it anywhere** in a B-roll shot, without a whole-project B-roll run or a full re-render. The web B-roll panel gets the same per-overlay "New from prompt / search".
2. **Money is recorded per generation** in a ledger that survives project deletion, shown as a monthly total, and a **monthly cap** stops a runaway agent loop.
3. **Files can live in S3-compatible storage** (MinIO in dev, R2/S3 later) and **jobs in a durable Redis queue**, both switched on by environment variables. `dev:lite` stays as it is.
4. **Ops debts are paid:** the pending DB columns are applied, `npm run build:server` works, the Docker stack (`make up`) actually renders, CI runs `npm run verify` on PRs, and uploads lose their EXIF/GPS data (spec row 2).

## What already exists (not rebuilt)

Claude over MCP (row 10: `inspect_project`, `apply_actions`, `render_frame`, `run_job`, `wait_job`, `create_project`, `upload_asset`, `export_outputs`, `list_projects`); per-project `creditsUsedCents`; the 30-day retention sweep; SSE job/project events; the staged progress model; `importRemote` (https only, capped, typed, probed).

## Goals / non-goals / anti-goals

- **Goals:** the five-tool loop of blueprint §10.3 step 8 is complete (`model_catalog`, `generate_assets` join the existing three); every paid generation is a ledger row; a restart never charges fal twice; `make up` renders the demo end to end; nothing leaves the Mac that didn't before.
- **Non-goals:** login/auth, multiple users, billing, a hosted deployment, a separate worker container, more generation models, a CSV export, migrating existing `DATA_DIR` files into MinIO, an in-app chat.
- **Anti-goals (a failure even if it works):** a retry or restart that pays fal twice; the cap silently ignored on any path that spends; prompt text or media kept after a project is deleted; GPS left in an uploaded file; `dev:lite` needing Docker, Redis or MinIO; the web app calling Claude or any Anthropic API.

## Decisions (as the owner took them)

| # | Topic | Decision |
|---|---|---|
| Q1 | Where Sabi runs | The Mac only. S3 storage and the queue are env-selected adapters; `dev:lite` stays files + in-memory; `make up` becomes a working production-shaped stack. |
| Q2 | Queue | BullMQ on Redis, worker **inside the API process**, one job at a time across the machine. After a restart captions/plan/render jobs re-run; broll/generate jobs fail as `interrupted` (no double charge). |
| Q3 | Agent assets | MCP `model_catalog` + `generate_assets` (no re-render) + action `addOverlay`; web B-roll panel gets "New from prompt / search" per overlay. |
| Q4 | Models | Unchanged: `fal-ai/flux/schnell` image 1 ¢, `fal-ai/kling-video/v1.6/standard/image-to-video` 25 ¢, Pexels photo/video 0 ¢. Adding one = one catalog entry. |
| Q5 | Spending | Web and agent have the same powers. Monthly cap `SPEND_CAP_CENTS`, default `2000` ($20), `0` = off; over the cap → `over_cap` on both. Ledger row: provider, model, media, cost, project id, job kind, actor (web/agent), time. Kept after the project is deleted, **no prompt text, no media**. |
| Q6 | Exports | No new exports. Usage view + `GET /api/usage` JSON. |
| Q7 | Screens/states | Projects header "This month $x.xx of $20.00" → `/usage` (months, rows); empty "No paid generations yet — stock B-roll is free"; "Queued — another project's job is running"; "Interrupted by a restart — run it again"; S3/Redis unreachable → API refuses to boot with a clear message. No onboarding. Phone 375 px and desktop. |
| Q8 | Ops | (a) apply the pending DB columns now; (b) fix `build:server`, Docker image renders, `make up` works; (c) GitHub Actions `npm run verify` on PRs (repo is public: free); (d) strip EXIF/GPS on upload. |
| Q9 | MinIO migration | No script. Old `DATA_DIR` files stay where they are; `dev:lite` keeps using them. |

## How it works

### 1. Agent assets

**API**

- `GET /api/catalog` → `{ models: [{ id, provider: "fal" | "pexels", media: "image" | "video", costCents, available }], spend: { monthCents, capCents } }`. `available` = the provider's key is set. The fal entries come from one `FAL_MODELS` table in `backend/shared/generator.ts` that `FalGenerator` also reads its costs from (today they are literals `1` and `25`).
- `POST /api/projects/:id/generate`, body `GenerateInput`:
  `{ source: "generate" | "stock", media: "image" | "video", prompt?: string (1–600), query?: string (1–200), overlayId?: string }` — `generate` needs `prompt`, `stock` needs `query` (zod refine).
  Synchronous refusals, in this order: `400 invalid_input`; `404`; `400 unknown_id` (overlayId); `503 generator_unavailable` / `stock_unavailable`; `402 over_cap { monthCents, capCents }` (generate only: `monthCents + model cost > cap`); `409 busy`. Then `202 { jobId }`.
- Job kind **`generate`** (stages `generate` → `import`). It **does not change project status and never renders**.
  - generate: `generator.generate({ prompt, media, ...DIMS[aspectRatio] })` → **ledger row written immediately** (fal has charged, even if the file later fails) → `importRemote` → asset with `meta { source: "generated", generationInfo, prompt }`; `creditsUsedCents += cost`.
  - stock: `stock.search(query, { media, orientation })` → import the first **3** results that import cleanly (**1** when `overlayId` is set) → assets with `meta { source: "stock", attribution, query }`. None → job fails `not_found`.
  - with `overlayId`: the overlay's asset is swapped for the first new asset (same id, range, placement), provenance copied, `query`/`prompt` updated; `outputs.stale = true` when an MP4 exists.
  - result: `{ assetIds }` (new field `JobState.result`).
- `GET /api/projects/:id/job?id=<jobId>` returns that job while the runner remembers it (memory: last 20 finished per project; BullMQ: its retained jobs). Without `id`: unchanged (active ?? last).
- `GET /api/projects/:id/assets` → the project's assets (the MCP `assets` section reads it).

**Asset provenance.** `AssetSchema.meta?: { source: "stock" | "generated" | "uploaded", attribution?, generationInfo?, prompt?, query? }`, stored in a new nullable `assets.meta JSONB`. The B-roll job writes it too. `replaceOverlay` and the new `addOverlay` copy `source` / `attribution` / `generationInfo` from it (absent → `"uploaded"`, today's behaviour), and `prompt` / `query` (cut to the overlay schema's 600 / 200 chars).

**Action `addOverlay`** `{ assetId, startMs, endMs, placement?, transition? }` (server-side, like `replaceOverlay`). The range must lie inside one shot of kind `B-Roll` (default placement `full`) or `Talking Head & B-Roll` (default `top`) → `shotId`; otherwise `not_in_broll_shot`. Overlapping an enabled overlay → `overlap`. Asset must be an image or video → else `bad_asset`. New id `nextId("ov")`; `intent` = `""`. Marks outputs stale like any visual action. Undo inverse (web): `removeOverlay`.

**MCP**

- `model_catalog` → one line per model (`fal-ai/flux/schnell image 1¢ available`), then `this month $0.43 of $20.00`.
- `generate_assets { projectId, source, media, prompt? | query? }` → POST, waits on `GET …/job?id=` (1 s poll, progress heartbeat as today), then prints one line per asset (`asset <id> image generated 1080×1920 "prompt…"` / `stock … Photo: <author> / Pexels`), up to 3 **image** assets inline as MCP images (videos: text only — place, then `render_frame`), the spend line, and the fresh `baseVersion`.
- `inspect_project { section: "assets" }` → image/video assets of the project (not the source, not renders), newest first, capped at 30, each marked with where it is used (`ov-3`, `mg-1 prop photo`, `logo`) or `unused`.
- `apply_actions` lists `addOverlay`. The client sends `x-sabi-actor: agent` on every request (attribution only; this is not auth).
- Error lines: `over_cap` → "monthly cap reached: $20.00 of $20.00 — raise SPEND_CAP_CENTS on the API"; `interrupted` → "interrupted by an API restart (nothing was charged twice); run it again".
- Skill `.claude/skills/sabi-editor/SKILL.md`: the loop becomes inspect → `model_catalog` (once) → `generate_assets` → `apply_actions addOverlay|replaceOverlay` → `render_frame` → `run_job render`; costs and the cap; prefer stock unless the user wants generated media.

**Web.** Each overlay row in the B-roll panel gets **New…** → a sheet with one field, prefilled: "Prompt" (media source Generate, shows "1 ¢" / "25 ¢") or "Search Pexels" (Stock only) → `POST /generate { source: project.mediaSource, media: overlay.media, prompt | query, overlayId }`. Progress shows on the existing staged progress (`generate` maps to "Generating B-roll"). `402` shows the over-cap notice; `503` the existing "set PEXELS_KEY / FAL_KEY" wording. "Another" stays as today.

### 2. Credit ledger and cap

```sql
CREATE TABLE IF NOT EXISTS credit_ledger (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,                    -- solo now (spec row 3)
  project_id  TEXT,                    -- no FK: rows outlive deleted projects
  provider    TEXT NOT NULL,           -- 'fal'
  model       TEXT NOT NULL,
  media       TEXT NOT NULL CHECK (media IN ('image', 'video')),
  cost_cents  INTEGER NOT NULL CHECK (cost_cents >= 0),
  job_kind    TEXT NOT NULL,           -- 'broll' | 'generate'
  actor       TEXT NOT NULL CHECK (actor IN ('web', 'agent')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_created_idx ON credit_ledger (created_at);
```

- `deps.ledger: CreditLedger { record(entry), monthTotal(now), usage(now) }` — Pg for `dev:server`/Docker, an **append-only JSON-lines file `$DATA_DIR/ledger.jsonl` for `dev:lite`** (it restarts on every save and spends real fal when `FAL_KEY` is set, so its cap must survive restarts), memory for tests only; months are **UTC calendar months**; `usage` = the last 12 months, newest first, each `{ month: "2026-10", totalCents, rows }`, ≤ 500 rows.
- `deps.spendCapCents` from `SPEND_CAP_CENTS` (default `2000`, `0` = off).
- Only paid generations are rows (Pexels is free and not logged).
- **Every fal call is preceded by the cap check** (`monthTotal + cost > cap` → refuse) and **followed by `record`**, in the B-roll job and the generate job alike. In the B-roll job an over-cap beat falls back to Pexels (as a fal failure does today) and adds the warning `over_cap` once; the generate job fails `over_cap`.
- Two jobs never run at once (one worker per process), so the check-then-record race cannot overshoot within one server.
- `creditsUsedCents` stays the per-project display total; the ledger is the record.
- `GET /api/usage` → `{ capCents, monthCents, months }`; each row `{ id, createdAt, model, media, costCents, jobKind, actor, projectId, projectTitle | null }` — titles from `projects.list()` (which does not bump `last_access`); `null` = deleted project.
- Actor: the route reads `x-sabi-actor` (`agent`, anything else → `web`) and passes it in the job data.

### 3. Storage adapter

`Storage` becomes an object store plus a local scratch area:

```ts
interface Storage {
  write(key: string, data: Readable | Buffer): Promise<void>;
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
  stat(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
  put(key: string, localPath: string): Promise<void>;          // move a finished local file in
  withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T>; // FS: the file itself; S3: a temp copy, deleted after
  workPath(name: string): string;                              // local scratch path
}
```

- **`FsStorage`** (default; `dev:lite` always): as today; `workPath` = `<DATA_DIR>/work/<name>` so `put` is a rename on the same disk.
- **`S3Storage`** (when `S3_ENDPOINT` is non-empty; `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` default `auto`, path-style): `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` (`Upload` streams multipart, so a 2 GB upload never sits in memory). `workPath` = `$WORK_DIR` (default `$TMPDIR/sabi-work`, on the Mac disk). Boot: `HeadBucket`; missing bucket → `CreateBucket`; unreachable → the API exits: `S3 storage at <endpoint> not reachable — run \`make db\` or unset S3_ENDPOINT`.
- Keys are validated once for both (no absolute path, no `..`, no empty segment).
- Every `localPath()` caller moves to the new shape:
  - **uploads**: `PUT` streams into `workPath("uploads/<id>")`; `done` sanitizes (§5) → probes → `put(key)`.
  - **importRemote**: download → work file → sanitize → probe → `put`.
  - **captions job**: `withLocalFile(source)` → extract WAV to a work file → transcribe → delete the WAV (it is no longer kept).
  - **renders**: Remotion writes to a work file → `put("renders/…mp4")`; SRT/VTT via `write`.
  - **frames**: a work file, deleted after reading (as today).
  - **file route**: one path for both adapters — `stat` → `req.range(size)` → `read(key, range)` with `206` / `Content-Range` / `Accept-Ranges: bytes`, `416` on an unsatisfiable range, `404 file_missing`. (`sendFile`'s ETag/304 goes; asset keys are never rewritten, so nothing is lost.)
- `removeProject` keeps deleting `work/<id>/audio.wav` for projects made before this change.
- **One database, one store.** A one-row table `sabi_meta (key 'storage', value 'fs:<DATA_DIR>' | 's3:<endpoint>/<bucket>')` is written on the first Postgres boot; a later boot with the other adapter exits: `this database's files are in <value>; set S3_ENDPOINT/DATA_DIR to match or use another DATABASE_URL`. So `make up` (S3) and an un-exported `dev:server` (files) can't share `make db`'s Postgres by accident (dangling files, half-done retention, demo in one store). `dev:server` stays env-selected; nothing loads `.env` for the npm scripts.

### 4. Job queue

- `JobRunner` takes **data, not closures**: `enqueue(projectId, kind, data) → Promise<JobState>`, `active(projectId)` (queued **or** running), `last(projectId)`, `get(projectId, jobId)`, plus `handle(kind, handler)`; handlers `({ projectId, data, report }) => Promise<JobResult | void>` load the project **when they start** (not at enqueue). Job data carries `{ input, actor, prevStatus }`; `prevStatus` replaces the status captured in today's closures.
- Kinds: `captions` (incl. render-only), `plan`, `broll`, `generate`. Handlers are registered in the composition root (`createApp`); the BullMQ worker starts only after that (`start()` from the server entry).
- **One job at a time across the machine** for both runners (`MemoryJobRunner` becomes one global FIFO; today it is per project). A queued job of another project shows "Queued — another project's job is running".
- **A generate job holds the project like every other job** (my call): `actions` and `frame` answer `409 busy` while it runs, so the overlay swap at its end needs no merge. Cost: **New…** on a video overlay locks that project for the 1–3 min Kling takes (as a B-roll run does today), and a generate job waits behind another project's job.
- **`BullJobRunner`** (when `REDIS_URL` is set): queue `sabi-jobs`, in-process `Worker` concurrency 1, `attempts: 1`, keep finished jobs for 7 days or the last 200. Job data holds prompt text, so deleting a project (by hand or by retention) also removes its retained jobs. Progress `{ progress, stage }` via `updateProgress` and the in-process event bus as today. Boot: `PING` with a timeout; failure → the API exits with `Redis at <url> not reachable — run \`make db\` or unset REDIS_URL`.
- **Restart rule:** an interrupted job comes back through BullMQ's stalled-job check (≤ ~30 s). A job started more than once (`attemptsStarted > 1` — confirm the field on the installed BullMQ) of kind `broll` or `generate` fails at once with `interrupted`: status → `prevStatus`, and `outputs.stale = true` if an MP4 exists. `captions` / `plan` re-run from the start.
- Boot without a queue keeps today's `failStuck()`; with BullMQ, `failStuck` skips projects that still have a queued/active job.
- `dev:lite` and tests: `MemoryJobRunner`.

### 5. Ops

- **Migrations:** `npm run db:migrate` (applies `schema.sql`, prints what it connected to). Run it once on this branch against `make db`'s Postgres (applies plans 2–4's columns plus `credit_ledger` and `assets.meta`). Data stays on the SSD (PROJECT.md rule): Postgres, MinIO and Redis keep their `${DATA_DIR}/<service>` bind mounts on the ExFAT SSD; a service that won't start there moves to `~/SabiDev/docker/<service>` (the APFS image on the same SSD), never a named volume on the Mac disk (17 GiB free). Whatever happens is recorded in PROJECT.md.
- **`build:server`:** `esbuild … --format=esm --packages=external --outfile=dist-server/index.mjs` (top-level await and native binaries stop being bundling problems).
- **Docker:** the `api` target becomes `node:22-bookworm-slim` + `ffmpeg` + Chrome headless-shell's shared libraries + `fonts-noto-color-emoji` (caption emoji), production `node_modules`, `shared/` (Remotion bundles it at runtime), `database/`, `dist-server/`; Chrome headless shell downloaded at build (`npx remotion browser ensure`; if Remotion has no linux-arm64 build, Debian `chromium` via `REMOTION_BROWSER_EXECUTABLE`). Compose adds `redis` (`redis:7-alpine`, `--appendonly yes --maxmemory-policy noeviction`, `${DATA_DIR}/redis`) and sets `REDIS_URL` + the S3 variables on `api`; `make db` also starts `redis`. Done when `make up` → upload → captions → render produces an MP4 (checked once by hand; disk: the Mac has ~17 GiB free, so build cache is pruned afterwards).
- **CI:** `.github/workflows/verify.yml` on pull requests and pushes to `main`: Node 22, `uv`, `ffmpeg`, `npm ci`, `npm run verify`, `npm run build`. No renders (no Chrome in CI).
- **EXIF/GPS (spec row 2):** `media.sanitize(in, out, kind)` — images through **sharp** (`rotate()` applies the EXIF orientation, then re-encode in the same format; sharp drops all metadata), audio/video through ffmpeg stream copy (`-map 0:v? -map 0:a? -map_metadata -1 -c copy`; rotation side data survives). Applied to uploads and to imported stock/generated media. Tests prove a GPS-tagged JPEG and a location-tagged MOV come out clean and a rotated phone photo/video keeps its displayed orientation.

## Blueprint sections

- **Folder structure:** `backend/modules/generate/` (route + job), `backend/modules/usage/` (ledger repos + `/usage` + `/catalog`), `backend/shared/storage.ts` (Fs + S3), `backend/shared/jobs.ts` (Memory + Bull runners), `backend/server/migrate.ts`, `frontend/src/features/usage/`, `.github/workflows/verify.yml`.
- **Component architecture:** `UsagePage` (route `/usage`), `UsageChip` (projects header), `NewOverlaySheet` (B-roll panel). Existing `Sheet`, `Button`, `Notice`, `Field` primitives; no new UI library.
- **Design system:** existing tokens only (`surface-*`, `ink*`, `accent`, `warn`, `danger`); money as `$0.00`, tabular numbers.
- **Responsive:** usage is a single-column list (no table) at 375 px, max-width 3xl on desktop like the projects page; the sheet is the existing bottom sheet on phones, dialog on desktop.
- **State:** TanStack Query keys `["usage"]`, `["catalog"]`; usage refetched when a broll/generate job completes (SSE job event) and on focus.
- **SEO:** none — the app is local and `noindex`.
- **Performance:** S3 only downloads what ffmpeg needs, streams ranges for the Player and the render browser; ledger queries use the `created_at` index and are bounded; one worker keeps the Mac responsive during renders.
- **Accessibility:** usage months are headed sections with lists; amounts have text, not colour; the sheet's field has a label; queued / interrupted / over-cap notices are `aria-live="polite"`; 44 px targets.
- **Analytics:** no new events (the ledger already records cost; analytics stays the opt-in funnel).
- **Deployment:** as §5; env reference in `.env.example` (`SPEND_CAP_CENTS`, `REDIS_URL`, `S3_REGION`, `WORK_DIR`).

## Trade-offs

- **BullMQ vs a Postgres queue:** BullMQ is what the blueprint names and is mature, but adds Redis; a Postgres queue would add no service. Chosen: BullMQ, env-selected, so `dev:lite` needs neither.
- **Worker in the API process vs a worker container:** in-process keeps the event bus in memory and one image; a separate worker would need events over Redis. Revisit only for a hosted deployment.
- **Temp downloads vs presigned URLs:** the render browser and the Player stream through the API (no bucket exposed, same host checks); ffmpeg needs local files, so S3 mode pays one download per probe/extract.
- **sharp vs ffmpeg for images:** sharp applies EXIF orientation reliably and drops metadata by default; ffmpeg's JPEG orientation handling differs by version (Mac 8.1 vs Debian 5.1). Cost: one native dependency (prebuilt for darwin-arm64 and linux).
- **Ledger + project sum:** a little duplication, but the project total needs no join and survives as the B-roll panel's figure.
- **Global concurrency 1:** a long render on one project delays another's plan; a 16 GB M4 can't do two renders well anyway.

## Left to the builder

BullMQ version and exact field names (`attemptsStarted`, stalled options); Chrome headless-shell install steps in Docker; GitHub Action versions; UI copy beyond the strings above; file and test names; whether `S3Storage` tests run against a fake client or a MinIO container (MinIO only behind an env flag, like `render:sample`).
