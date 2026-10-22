# Agent and Ops (plan 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent makes and places single assets (`model_catalog`, `generate_assets`, `addOverlay`; web **New…**), every paid generation is a ledger row under a monthly cap, files can live in S3-compatible storage and jobs in a durable BullMQ queue (both env-selected), and the ops debts are paid (migrations command, working `build:server` and `make up`, CI, EXIF/GPS stripping).

**Architecture:** Jobs become data (`kind` + `{ input, actor, prevStatus }`) run by registered handlers, so the in-memory runner and the BullMQ runner are interchangeable and one worker runs one job at a time machine-wide. Every fal call goes through one function that checks the cap first and writes the ledger row right after fal answers. `Storage` becomes an object store plus a local scratch area (`workPath`, `put`, `withLocalFile`, ranged `read`), so ffmpeg/Remotion work on local files whether the store is a folder or a bucket; uploads and imports go work file → probe → sanitize → `put`.

**Tech Stack:** existing (Express 5, zod 4, React 19, TanStack Query 5, Remotion 4.0.536, MCP SDK, pg) + `bullmq` (with its `ioredis`), `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`, `sharp`. Pick each at its newest version published ≥ 7 days before install, and pin it exactly. Install only with `npm run deps -- <pkg>@<version>`, never plain `npm install`.

**Spec:** `docs/superpowers/specs/2026-10-22-agent-and-ops-design.md` (the design, incl. every blueprint section) and `docs/spec.md` rows **19–23**, with rows 2 (EXIF stripped, 30-day retention), 3 (solo; `user_id` nullable), 6 (MinIO dev / R2–S3 prod), 7 (fal + Pexels), 9 (ledger, no billing), 10 (Claude over MCP; the web never calls Claude), 14 (one write path, explicit export). Builds on: `backend/shared/{jobs,storage,deps,generator,importRemote,media,renderer,pg}.ts`, `backend/modules/{pipeline,editplan,broll,actions,assets,frames,events,projects,retention}/`, `backend/mcp/{client,tools}.ts`, `shared/contract.ts`, `shared/editing/applyLocal.ts`, `frontend/src/features/{editor,projects}/`. Conventions: `PROJECT.md`.

**Where to execute:** this worktree (`.claude/worktrees/sleepy-jepsen-e58c87`), branch `claude/agent-and-ops` (cut from `claude/tagalog-pipeline`, PR #6). `node_modules` is already linked (`npm run deps`). Docker is running.

## Global Constraints

- **No Anthropic API, no model calls from the web app** (rows 7, 10). Billing rule: no Anthropic keys anywhere.
- **Cap:** `SPEND_CAP_CENTS` — unset or empty → `2000`; `0` → off; anything that is not a whole number ≥ 0 → the server refuses to boot (`SPEND_CAP_CENTS must be a whole number of cents (0 = no cap)`). Months are UTC calendar months. Over the cap: error code `over_cap`, HTTP `402 { error: "over_cap", monthCents, capCents }`.
- **Costs** (one table, `FAL_MODELS` in `backend/shared/generator.ts`): `fal-ai/flux/schnell` image **1 ¢**, `fal-ai/kling-video/v1.6/standard/image-to-video` video **25 ¢**; Pexels **0 ¢**, never a ledger row.
- **Ledger rows** hold no prompt text and no media; they survive project deletion (no FK).
- **Actor:** header `x-sabi-actor: agent` (the MCP client sends it on every request) → `"agent"`, anything else → `"web"`. Attribution only, not auth.
- **No double charge:** a `broll` or `generate` job that starts a second time (restart) fails `interrupted` before any fal call.
- **One job at a time across the machine** (both runners). A project with a queued or running job answers `409 busy` to actions, frames, jobs and delete, as today.
- **Env switches:** `S3_ENDPOINT` non-empty → S3 storage (`S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` default `auto`, path-style); `REDIS_URL` non-empty → BullMQ. `dev:lite` always uses files, in-memory jobs and `$DATA_DIR/ledger.jsonl`. An unreachable S3/Redis stops the server at boot with: `S3 storage at <endpoint> not reachable — run \`make db\` or unset S3_ENDPOINT` / `Redis at <url> not reachable — run \`make db\` or unset REDIS_URL`.
- **Data on the SSD:** compose bind mounts stay `${DATA_DIR}/<service>`; a service that can't start on the ExFAT SSD moves to `${HOME}/SabiDev/docker/<service>`, never a named volume on the Mac disk.
- **Copy (exact):** usage chip `This month $0.42 of $20.00` (cap off: `This month $0.42`); empty usage `No paid generations yet — stock B-roll is free`; queued `Queued — another project's job is running`; interrupted `Interrupted by a restart — run it again.`; over cap `Monthly spending cap reached — see Usage.`; MCP over cap `monthly cap reached: $20.00 of $20.00 — raise SPEND_CAP_CENTS on the API`; MCP interrupted `interrupted by an API restart (nothing was charged twice); run it again`.
- **Infra-gated tests** (skipped unless the env var is set, like `render:sample`): `PG_TEST_URL`, `S3_TEST_ENDPOINT` (+ `S3_TEST_ACCESS_KEY`, `S3_TEST_SECRET_KEY`), `REDIS_TEST_URL`; `npm run test:infra` sets all three against `make db` and must pass in this session after Tasks 1, 4, 10 and 11.
- TDD, colocated tests, `npm run verify` green before every commit; `npm run build` green after frontend tasks; `npm run render:sample` after Tasks 8 and 12 (they touch rendering). Backend imports stay relative; `schema.sql` changes are idempotent (`IF NOT EXISTS`). Commits carry no AI co-author or "Generated with" lines. No `cd` in compound shell commands. One whole-branch review at the end, not per task.

## Review Focus

1. **The API restarts in the middle of a paid generation:** the job comes back but never calls fal again; it fails `interrupted`, the project's status is restored, and the MP4 is marked stale if one exists. → Task 11 test `an interrupted generate job fails without calling fal again`.
2. **The cap is reached partway through a B-roll run, or the agent loops `generate_assets`:** no fal call is made past the cap; B-roll beats fall back to Pexels with warning `over_cap`; a direct generate gets `402` without a job. → Task 4 test `over the cap a B-roll beat falls back to Pexels without calling fal`; Task 5 test `generate over the cap answers 402 and starts no job`.
3. **`SPEND_CAP_CENTS=` (empty) or `SPEND_CAP_CENTS=20$` in a shell or compose file:** an empty value means the default, not "no cap"; garbage refuses to boot. → Task 4 test `parseSpendCap`.
4. **The Player, iOS Safari and the render browser seek inside a video:** `bytes=0-`, `bytes=100-199`, suffix `bytes=-500`, a range past the end (`416`), no Range header (`200` with `Accept-Ranges`). Both stores behave the same. → Task 8 test `serves byte ranges like a static file server`; Task 10 runs the same storage contract against MinIO.
5. **A phone photo with GPS and EXIF orientation 6, or an iPhone MOV with a location and a 90° rotation, is uploaded:** the stored file has no GPS or location, still displays upright, and the asset's width/height are the displayed ones. → Task 9 tests `a GPS-tagged rotated JPEG is stored upright without EXIF`, `a located rotated MOV keeps its rotation and loses its location`.

---

### Task 1: Migration command and the pending columns

**Files:**
- Create: `backend/server/migrate.ts`, `tests/integration/pg.test.ts`
- Modify: `package.json` (scripts `db:migrate`, `test:infra`), `infrastructure/docker/docker-compose.yml` (only if Postgres can't start on the SSD), `.env` (local, gitignored: copy of `.env.example`)

**Interfaces:**
- Produces: `npm run db:migrate` (reads `DATABASE_URL`, default `postgres://captions:captions@localhost:5432/captions`; prints `schema applied to <host>/<db>`); `tests/integration/pg.test.ts` with helper `withTestDb(fn: (pool: Pool) => Promise<void>)` that creates `sabi_test_<random>` on `PG_TEST_URL`, applies the schema, runs `fn`, drops the database. Later tasks add their Pg cases to this file.

- [ ] **Step 1:** Write `tests/integration/pg.test.ts` (`describe.skipIf(!process.env.PG_TEST_URL)`): test `schema.sql applies twice` — `applySchema(pool)` twice in one `withTestDb`, then `SELECT column_name FROM information_schema.columns WHERE table_name='projects'` contains `caption_style`, `demo`, `motion_graphics`, `credits_used_cents`, `edit_plan`.
- [ ] **Step 2:** `cp .env.example .env`; `make db`. If Postgres exits with an ownership/permission error on `${DATA_DIR}/postgres`, change its volume to `${HOME}/SabiDev/docker/postgres` (create the folder), re-run, and note it for PROJECT.md. Same check for MinIO.
- [ ] **Step 3:** Add `test:infra`: `PG_TEST_URL=postgres://captions:captions@localhost:5432/captions S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY=minio S3_TEST_SECRET_KEY=minio12345 REDIS_TEST_URL=redis://localhost:6379 vitest run tests/integration/pg.test.ts backend/shared/storage.test.ts backend/shared/bullJobs.test.ts`. Run it; expected: the pg test PASS (others not yet present or skipped).
- [ ] **Step 4:** Implement `backend/server/migrate.ts` (`createPool` → `applySchema` → log → `pool.end()`), script `db:migrate` = `tsx backend/server/migrate.ts`. Run `npm run db:migrate`; expected `schema applied to localhost/captions`. The columns from plans 2–4 are now applied.
- [ ] **Step 5:** `npm run verify` → green. Commit `chore(db): db:migrate command, infra-gated Postgres test; pending columns applied`.

### Task 2: Jobs as data, one machine-wide queue

**Files:**
- Modify: `backend/shared/jobs.ts`, `backend/shared/jobs.test.ts`, `shared/contract.ts` (`Actor`, `JobResultSchema`, `JobStateSchema.result`, `ACTOR_HEADER`), `shared/types.ts`, `backend/shared/routes.ts` (`actorOf`), `backend/shared/apiTestHelpers.ts` (`holdJob`), `backend/app/app.ts`, every `start*Job` and every `deps.jobs.*` caller (pipeline, editplan, broll, actions, frames, events, projects, retention + their tests, `backend/mcp/*.test.ts`)
- Create: `backend/app/jobs.ts`

**Interfaces:**
- Produces:
```ts
// shared/contract.ts
export const Actor = z.enum(["web", "agent"]);
export const ACTOR_HEADER = "x-sabi-actor";
export const JobResultSchema = z.object({ assetIds: z.array(z.string()) });
// JobStateSchema gains: result: JobResultSchema.optional()

// backend/shared/jobs.ts
export type JobData = { input: unknown; actor: Actor; prevStatus: ProjectStatus };
export type JobContext = { projectId: string; jobId: string; data: JobData; attempt: number; report(progress: number, stage?: string): void };
export type JobHandler = (ctx: JobContext) => Promise<JobResult | void>;
export class JobBusy extends Error { constructor(readonly job: JobState) }
export interface JobRunner {
  handle(kind: string, handler: JobHandler): void;             // later registration of the same kind replaces it
  enqueue(projectId: string, kind: string, data: JobData): Promise<JobState>; // throws JobBusy if the project has a queued or running job
  active(projectId: string): Promise<JobState | null>;        // queued or running
  last(projectId: string): Promise<JobState | null>;          // most recent finished
  get(projectId: string, jobId: string): Promise<JobState | null>;
  forget(projectId: string): Promise<void>;                   // drop the project's finished jobs (job data holds prompts)
  start?(): Promise<void>;                                    // BullMQ: begin consuming after handlers are registered
}
export class MemoryJobRunner implements JobRunner  // one global FIFO, one job at a time; keeps the last 20 finished per project; attempt is always 1
// backend/shared/routes.ts
export const actorOf: (req: Request) => Actor;
// backend/app/jobs.ts — called by createApp(deps)
export function registerJobHandlers(deps: AppDeps): void;    // "captions", "plan", "broll" now; "generate" in Task 5
// handler factories (in their modules): captionJob(deps), planJob(deps), brollJob(deps): JobHandler
// enqueue helpers keep their names, become async and take the actor:
startCaptionJob(deps, project, opts: RunOptions, actor: Actor): Promise<JobState>  // likewise startPlanJob, startBrollJob
// backend/shared/apiTestHelpers.ts
export function holdJob(deps: AppDeps, projectId: string): Promise<() => void>; // enqueues kind "hold" that waits until released
```
- `GET /api/projects/:id/job?id=<jobId>` → that job or `404 { error: "not_found" }`; without `id` unchanged.

- [ ] **Step 1: Write the failing runner tests** in `jobs.test.ts` (rewrite the three existing ones onto `handle`/`enqueue`):
  - `runs one job at a time across projects, in order` — handlers for `a` (p1) and `b` (p2) gated; `active("p2")` is `QUEUED` while `a` runs; order `["a","b"]`.
  - `reports progress, result and failure` — a handler returning `{ assetIds: ["x"] }` ends `COMPLETE` with `result.assetIds = ["x"]`; a throwing one ends `FAILED` with its message; `last()` returns it.
  - `refuses a second job for a busy project` — second `enqueue("p1", …)` rejects with `JobBusy` whose `job.id` is the first.
  - `get finds a finished job by id and forget drops it` — `get("p1", id)` → `COMPLETE`; after `forget("p1")` → `null`; `get("p2", id)` → `null`.
  - `an unknown kind fails with no_handler`.
- [ ] **Step 2:** `npx vitest run backend/shared/jobs.test.ts` → FAIL.
- [ ] **Step 3:** Implement the runner, `actorOf`, contract fields. Move the three job bodies into `captionJob`/`planJob`/`brollJob` handlers that **load the project when they start** (`not_found` if it is gone) and restore `data.prevStatus` where the closures used the captured `project.status`. `registerJobHandlers` in `createApp`. Routes `await` `active`, pass `actorOf(req)`, and map `JobBusy` to `409 { error: "busy", job }`; the actions route, when its `render: true` follow-up hits `JobBusy`, stores `outputs.stale = true` and answers `200` without `jobId`. Retention skips projects whose `active()` is non-null; `removeProject` calls `deps.jobs.forget(id)`.
- [ ] **Step 4:** Add route tests: `GET /job?id= returns that job after another finished` (events), `two quick renders: the second gets 409 busy` (pipeline routes, both requests in `Promise.all`), `a job whose project was deleted while queued fails not_found` (use `holdJob` on another project to keep it queued, delete it, release). Replace closure-based `deps.jobs.enqueue` in tests with `holdJob`.
- [ ] **Step 5:** `npm run verify` → green. Commit `refactor(jobs): jobs are data run by registered handlers, one at a time across the machine`.

### Task 3: Asset provenance and `addOverlay`

**Files:**
- Modify: `shared/contract.ts`, `shared/types.ts`, `shared/editing/applyLocal.ts` (`SERVER_ONLY` gets `addOverlay`), `backend/modules/actions/apply.ts` (+ test), `backend/modules/assets/repository.ts`, `database/schema/schema.sql`, `backend/modules/broll/job.ts`, `backend/shared/importRemote.ts` (+ test), `frontend/src/features/editor/actions/inverse.ts` (+ test), `tests/integration/pg.test.ts`

**Interfaces:**
- Produces:
```ts
export const AssetMetaSchema = z.object({ source: OverlaySource, attribution: AttributionSchema.optional(), generationInfo: GenerationInfoSchema.optional(), prompt: z.string().optional(), query: z.string().optional() });
// AssetSchema gains: meta: AssetMetaSchema.optional()   (absent = uploaded)
// ActionSchema gains:
z.object({ type: z.literal("addOverlay"), assetId: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), placement: OverlayPlacement.optional(), transition: OverlayTransition.optional() })
// backend/shared/importRemote.ts
export function importAsAsset(deps: Pick<AppDeps, "storage" | "media" | "id" | "fetch" | "assets" | "now">, req: { projectId: string; url: string; media: OverlayMedia; meta: AssetMeta }): Promise<Asset>;
```
- `schema.sql`: `ALTER TABLE assets ADD COLUMN IF NOT EXISTS meta JSONB;`

- [ ] **Step 1: Write the failing tests** in `apply.test.ts`:
  - `addOverlay places an asset inside a B-Roll shot` — new overlay `ov-<next>`, `shotId` of the containing shot, placement `full` (B-Roll) / `top` (Talking Head & B-Roll) by default, `transition: "fade"`, `enabled: true`, `intent: ""`, `source`/`attribution`/`generationInfo`/`prompt`/`query` from `asset.meta`, `durationMs` for a video asset; `rerender: true`.
  - `addOverlay refuses a range outside one B-roll shot` → `{ error: "not_in_broll_shot" }` (a Talking Head shot; a range spanning two shots); `end <= start` or past `sourceDurationMs` → `out_of_range`; over an enabled overlay → `overlap`; a subtitle asset → `bad_asset`.
  - `replaceOverlay copies the asset's provenance` — a `generated` asset sets `source: "generated"` + `generationInfo` and the prompt; an asset without `meta` stays `"uploaded"` (today's behaviour).
  - `inverse.test.ts`: `addOverlay undoes as removeOverlay of the id it creates`.
- [ ] **Step 2:** Run them → FAIL.
- [ ] **Step 3:** Implement. Prompt/query copied into the overlay are cut to 600/200 chars. `importAsAsset` = today's B-roll `importAsset` moved out (writes `meta`); the B-roll job passes `meta` (`stock` + attribution + query, or `generated` + generationInfo + prompt). `PgAssetRepository` reads/writes `meta`.
- [ ] **Step 4:** Pg case in `pg.test.ts`: `asset meta round-trips`. `npm run test:infra` → PASS; `npm run verify` → green.
- [ ] **Step 5:** Commit `feat(actions): assets carry provenance; addOverlay places one inside a B-roll shot`.

### Task 4: Credit ledger, cap, catalog, usage

**Files:**
- Create: `backend/modules/usage/ledger.ts` (+ test), `backend/modules/usage/spend.ts` (+ test), `backend/modules/usage/routes.ts` (+ test)
- Modify: `backend/shared/generator.ts` (`FAL_MODELS`), `backend/shared/deps.ts`, `backend/shared/testing.ts`, `backend/server/index.ts`, `backend/app/app.ts`, `backend/modules/broll/job.ts` (+ routes test), `database/schema/schema.sql`, `shared/contract.ts`, `shared/types.ts`, `.env.example`, `tests/integration/pg.test.ts`

**Interfaces:**
- Produces:
```ts
// backend/modules/usage/ledger.ts
export type LedgerEntry = { id: string; projectId: string | null; provider: "fal"; model: string; media: OverlayMedia; costCents: number; jobKind: "broll" | "generate"; actor: Actor; createdAt: string };
export interface CreditLedger { record(e: LedgerEntry): Promise<void>; since(from: Date): Promise<LedgerEntry[]> } // newest first
export class MemoryCreditLedger; export class JsonlCreditLedger { constructor(path: string) } // malformed lines skipped
export class PgCreditLedger { constructor(pool: Pool) }
export const monthStart: (now: Date) => Date;           // UTC
export function usageMonths(entries: LedgerEntry[], titles: Map<string, string>, now: Date): Usage["months"]; // ≤ 12 months, only months with rows, rows ≤ 100 each, totals over all rows
// backend/modules/usage/spend.ts
export class OverCap extends Error { constructor(readonly monthCents: number, readonly capCents: number) }
export function parseSpendCap(env: string | undefined): number;
export function monthSpend(deps: Pick<AppDeps, "ledger" | "now">): Promise<number>;
export function chargeGeneration(deps: AppDeps, req: { projectId: string; prompt: string; media: OverlayMedia; width: number; height: number; jobKind: "broll" | "generate"; actor: Actor }): Promise<GeneratedMedia>; // OverCap before fal; ledger row right after fal answers
// backend/shared/generator.ts
export const FAL_MODELS: Record<OverlayMedia, { id: string; costCents: number }>;
// AppDeps gains: ledger: CreditLedger; spendCapCents: number
// contract: CatalogSchema, UsageRowSchema, UsageSchema; api.catalog = "/api/catalog", api.usage = "/api/usage"
```
- `GET /api/catalog` → `{ models: [{ id, provider: "fal" | "pexels", media, costCents, available }], spend: { monthCents, capCents } }` — four models: the two `FAL_MODELS` (`available: !!deps.generator`), `pexels-photo`/`pexels-video` (`available: !!deps.stock`).
- `GET /api/usage` → `{ capCents, monthCents, months: [{ month: "2026-10", totalCents, rows: [{ id, createdAt, model, media, costCents, jobKind, actor, projectId, projectTitle: string | null }] }] }` — titles from `deps.projects.list()` (never `get`, which bumps `last_access`).
- `schema.sql`: the `credit_ledger` table and index exactly as in the design §2.

- [ ] **Step 1: Write the failing tests:**
  - `ledger.test.ts` (run for Memory and Jsonl): `records and returns rows newest first since a date`; `monthStart is the UTC month` (`2026-10-31T16:30:00Z` → `2026-10-01T00:00:00Z`; a row at `2026-11-01T00:30+08:00` counts in October); `usageMonths groups by month, keeps totals over capped rows, names deleted projects null`; Jsonl: `survives a new instance on the same file` and `skips a malformed line`.
  - `spend.test.ts`: `parseSpendCap` — `undefined` → 2000, `""` → 2000, `"0"` → 0, `"500"` → 500, `"20$"`/`"-1"`/`"1.5"` throw; `chargeGeneration` — `refuses before calling fal when the month would pass the cap` (FakeGenerator records no call; `OverCap` with monthCents/capCents), `cap 0 never refuses`, `writes one row per fal answer even when the import later fails` (actor and jobKind kept, no prompt field on the row).
  - `routes.test.ts`: `catalog lists the four models with availability and spend`; `usage reports months, the cap and deleted projects`.
  - `broll/routes.test.ts`: `a generate-mode B-roll run writes one ledger row per fal image, as the web`; `over the cap a B-roll beat falls back to Pexels without calling fal` (cap 1, a row of 1 ¢ already this month → `generator.calls` unchanged, overlay `source: "stock"`, warning `over_cap` once); `x-sabi-actor: agent marks the rows as agent`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. The B-roll job's fal branch calls `chargeGeneration`; `OverCap` is caught like any fal failure (Pexels fallback) and adds `over_cap` once. Deps: tests `MemoryCreditLedger` + `2000`; `makeMemoryDeps` `JsonlCreditLedger(join(dataDir, "ledger.jsonl"))` + `parseSpendCap(env)`; `index.ts` `PgCreditLedger(pool)` + `parseSpendCap(env)`. `.env.example`: `SPEND_CAP_CENTS=2000` with a one-line comment.
- [ ] **Step 4:** Pg case: `pg credit ledger records and reads since a date` → `npm run test:infra` PASS; `npm run verify` → green.
- [ ] **Step 5:** Commit `feat(usage): credit ledger per fal generation, monthly cap, /api/usage and /api/catalog`.

### Task 5: Generate job and route

**Files:**
- Create: `backend/modules/generate/routes.ts`, `backend/modules/generate/job.ts`, `backend/modules/generate/routes.test.ts`
- Modify: `shared/contract.ts` (`GenerateInput`, `api.projectGenerate`, `api.projectAssets`), `shared/types.ts`, `backend/app/app.ts`, `backend/app/jobs.ts`, `backend/modules/assets/routes.ts` (+ test)

**Interfaces:**
- Consumes: `chargeGeneration`, `monthSpend`, `FAL_MODELS` (Task 4); `importAsAsset`, `AssetMeta` (Task 3); `JobRunner`, `actorOf` (Task 2); `applyActions` with `replaceOverlay` (provenance from Task 3).
- Produces:
```ts
export const GenerateInput = z.object({
  source: MediaSource, media: OverlayMedia,
  prompt: z.string().trim().min(1).max(600).optional(), query: z.string().trim().min(1).max(200).optional(), overlayId: z.string().optional(),
}).refine((v) => (v.source === "generate" ? !!v.prompt : !!v.query), { message: "prompt_or_query" });
api.projectGenerate(id) = `/api/projects/${id}/generate`; api.projectAssets(id) = `/api/projects/${id}/assets`
export function startGenerateJob(deps: AppDeps, project: Project, input: GenerateInput, actor: Actor): Promise<JobState>;
export function generateJob(deps: AppDeps): JobHandler; // kind "generate", stages "generate" → "import", result { assetIds }
```
- `POST /api/projects/:id/generate` refusals in order: `400 invalid_input`, `404`, `400 unknown_id`, `503 generator_unavailable | stock_unavailable`, `402 over_cap`, `409 busy`; else `202 { jobId }`. `GET /api/projects/:id/assets` → the project's assets (`404` without the project).

- [ ] **Step 1: Write the failing tests** (`generate/routes.test.ts`, `assets/routes.test.ts`):
  - `generates one image, records it and returns its asset id` — job `COMPLETE`, `result.assetIds` length 1, asset `meta.source "generated"` with `generationInfo` + prompt, one ledger row (`jobKind: "generate"`), `creditsUsedCents` +1, **project status unchanged**, no render call (`FakeRenderer.calls` empty).
  - `a stock query imports up to three candidates` — FakeStock returning `[IMG1, IMG2, IMG1-copy]` → 3 assets with attribution + query; with `overlayId` → 1.
  - `overlayId swaps that overlay and marks the MP4 stale` — same overlay id/range/placement, new `assetId`, provenance, `outputs.stale: true`.
  - `generate over the cap answers 402 and starts no job` — `{ error: "over_cap", monthCents, capCents }`, `GET /job` null, `generator.calls` empty.
  - `refusals come in order` — bad body 400, unknown project 404, unknown overlay 400, `generator: null` 503, held job 409.
  - `a stock query with no results fails not_found`.
  - `lists a project's assets with their provenance` (`GET /assets`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; dims from `DIMS[project.aspectRatio]`, orientation as the B-roll job. The overlay swap folds `replaceOverlay` through `applyActions` and updates with `ifVersion` (retry once on `StaleVersion`).
- [ ] **Step 4:** `npm run verify` → green.
- [ ] **Step 5:** Commit `feat(generate): one-asset generate job (fal or Pexels), no render; GET project assets`.

### Task 6: MCP tools and skill

**Files:**
- Modify: `backend/mcp/client.ts`, `backend/mcp/tools.ts`, `backend/mcp/tools.test.ts`, `backend/mcp/server.test.ts`, `.claude/skills/sabi-editor/SKILL.md`

**Interfaces:**
- Consumes: routes from Tasks 2, 4, 5.
- Produces: `SabiApi` sends `x-sabi-actor: agent` on every request and gains `generate(id, input)`, `getJobById(id, jobId)`, `catalog()`, `listAssets(id)`, `assetBytes(assetId): Promise<Buffer>`; tools `model_catalog {}`, `generate_assets { projectId, source, media, prompt?, query? }`; `inspect_project` `section` enum gains `"assets"`; `apply_actions` description names `addOverlay`.

- [ ] **Step 1: Write the failing tests** in `tools.test.ts`:
  - `TOOL_NAMES` contains `model_catalog` and `generate_assets` (server test: 11 tools listed).
  - `model_catalog prints models, availability and the month` — lines like `fal-ai/flux/schnell · image · 1¢ · available`, last line `this month $0.00 of $20.00`.
  - `generate_assets waits for the job and shows the images` — one MCP image (`image/png`), text has `asset <id> image generated` and `baseVersion:`; a ledger row with `actor: "agent"`.
  - `generate_assets explains the cap` — cap reached → `isError`, text `monthly cap reached: $0.01 of $0.01 — raise SPEND_CAP_CENTS on the API`.
  - `wait_job explains an interrupted job` — a finished job with error `interrupted` → the exact interrupted line.
  - `inspect assets marks where each asset is used` — `ov-0`, `mg-0 prop photo`, `logo`, `unused`; source and renders not listed.
  - `apply_actions addOverlay works through MCP`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `generate_assets` polls `getJobById` every second (existing heartbeat), inlines at most 3 image assets ≤ 5 MiB each, prints the spend line and the fresh `baseVersion`. Skill: loop inspect → `model_catalog` (once) → `generate_assets` → `apply_actions addOverlay | replaceOverlay` → `render_frame` → `run_job render`; prefer stock unless the user asks for generated media; costs and the cap; `inspect_project {section:"assets"}` to find earlier assets.
- [ ] **Step 4:** `npm run verify` → green.
- [ ] **Step 5:** Commit `feat(mcp): model_catalog, generate_assets, assets section, addOverlay; agent actor header`.

### Task 7: Web — usage, New…, queued and interrupted states

**Files:**
- Create: `frontend/src/features/usage/api.ts`, `UsageChip.tsx`, `UsagePage.tsx`, `UsagePage.test.tsx`, `frontend/src/features/editor/panels/NewOverlaySheet.tsx` (+ test)
- Modify: `frontend/src/routes/router.tsx`, `frontend/src/features/projects/api/projects.ts` (`generateAsset`), `frontend/src/features/projects/hooks/{projectEvents,useProjectEvents}.ts` (+ test), `frontend/src/features/editor/panels/{BrollPanel,progressModel,StageProgress}.tsx|ts` (+ tests), `frontend/src/features/editor/EditorPage.tsx`

**Interfaces:**
- Consumes: `GET /api/usage`, `GET /api/catalog`, `POST …/generate` (Tasks 4–5).
- Produces: `usd(cents: number): string` (`42` → `"$0.42"`); `getUsage()`, `getCatalog()` (zod-parsed); route `/usage`; `EventsState` gains `running: boolean` (QUEUED/PROCESSING) and `queued: boolean`; `jobErrorText(error: string): string`; `BrollPanel` prop `onGenerate(input: GenerateInput): void`; progress step `["generate", ["generate", "import"], "generating", 0, 100]`.

- [ ] **Step 1: Write the failing tests:**
  - `UsagePage.test.tsx`: `shows months, totals and rows` (`$0.26`, `Kling video`/model id, `agent`, `Deleted project`, a link to `/p/<id>` for a live one); `empty state` (exact copy); `UsageChip` copy with cap and with cap 0.
  - `NewOverlaySheet` test: generate mode → field labelled `Prompt` prefilled with the overlay's prompt and the cost `1 ¢` (image) / `25 ¢` (video); stock mode → `Search Pexels` prefilled with the query, no cost; submit calls `onGenerate({ source, media, prompt | query, overlayId })`.
  - `BrollPanel.test.tsx`: `each overlay has a New… button`.
  - `projectEvents.test.ts`: `queued and running follow the job state`; `progressModel.test.ts`: `a generate job maps onto Generating B-roll`; `jobErrorText` maps `interrupted` and `over_cap` to the exact copy, passes anything else through.
  - `StageProgress`: `queued shows the queued copy`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Editor `busy` also counts `events.running`; failures go through `jobErrorText`; `["usage"]` is invalidated when a `broll`/`generate` job completes or fails. The chip sits in the projects header beside the api status. 44 px targets, `aria-live` on notices, single-column list at 375 px.
- [ ] **Step 4:** `npm run verify` and `npm run build` → green. Manual: `FAKE_AI=1 npm run dev:lite` + `npm run dev`, browser pane at 375 px and desktop: New… on a demo overlay with a prompt → progress → overlay swapped, export stale; `/usage` shows the row (FAKE generator still ledgers 1 ¢); chip updates.
- [ ] **Step 5:** Commit `feat(web): usage page and chip, New… per overlay, queued/interrupted states`.

### Task 8: Storage as object store + scratch (files)

**Files:**
- Modify: `backend/shared/storage.ts`, `backend/modules/assets/routes.ts` (+ test), `backend/shared/importRemote.ts` (+ test), `backend/modules/pipeline/pipeline.ts` (+ test), `backend/modules/frames/routes.ts`, `backend/modules/projects/remove.ts` (+ test), `backend/modules/demo/seed.ts` if needed
- Create: `backend/shared/storage.test.ts`

**Interfaces:**
- Produces:
```ts
export type ByteRange = { start: number; end: number }; // inclusive
export interface Storage {
  write(key: string, data: Readable | Buffer): Promise<void>;
  read(key: string, range?: ByteRange): Promise<Readable>;
  stat(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
  put(key: string, localPath: string): Promise<void>;          // moves the local file in
  withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T>;
  workPath(name: string): string;                             // local scratch; parent folders created
  describe(): string;                                          // "fs:<root>" | "s3:<endpoint>/<bucket>"
}
export function checkKey(key: string): string; // throws Error("bad_key"): absolute, "..", empty segment, backslash
export function storageContract(make: () => Promise<Storage>): void; // shared describe() body, reused by S3 in Task 10
```
- `FsStorage.workPath(name)` = `<root>/work/<name>`. `localPath` is gone.

- [ ] **Step 1: Write the failing tests:** `storage.test.ts` runs `storageContract(() => FsStorage(tmp))`: write/read whole and ranged, `stat` null for missing, `remove` idempotent, `put` moves (source gone), `withLocalFile` gives a readable path, `bad_key` for `../x`, `/x`, `a//b`. Asset route test `serves byte ranges like a static file server` (Review Focus 4: `bytes=0-`, `bytes=100-199` → 206 + `Content-Range: bytes 100-199/<size>` + 100 bytes, `bytes=-500`, past end → 416 + `Content-Range: bytes */<size>`, none → 200 + `Accept-Ranges: bytes`, missing file → 404 `file_missing`). Captions job test: `the extracted WAV is deleted after transcription`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and move every caller (design §3): uploads `PUT` → `workPath("uploads/<id><ext>")`, `done` probes the work file then `put`s; `importRemote` downloads to a work file, probes, `put`s; captions extracts from `withLocalFile(source.key)` into `workPath("audio/<projectId>.wav")` and removes it after transcribing; renders write to `workPath("renders/<id>.mp4")` then `put`; frames use a work file. `removeProject` removes `workPath("<id>/audio.wav")` (legacy) with `rm(..., { force: true })`. The file route uses `req.range(size)`.
- [ ] **Step 4:** `npm run verify` → green; `npm run render:sample` → all pass.
- [ ] **Step 5:** Commit `refactor(storage): object store + local scratch; ranged reads on one file route`.

### Task 9: Strip EXIF/GPS on upload and import

**Files:**
- Modify: `backend/shared/media.ts` (+ `media.test.ts`), `backend/modules/assets/routes.ts`, `backend/shared/importRemote.ts`, `package.json` (`sharp`)

**Interfaces:**
- Produces: `Media.sanitize(inPath: string, outPath: string, kind: ProbeKind): Promise<void>` — `image`: sharp `rotate()` then the same format as `outPath`'s extension (`.jpg` q 92, `.png`, `.webp` q 92), no metadata; `av`: `ffmpeg -v error <safe av> -i in -map 0:v? -map 0:a? -map_metadata -1 -c copy out`. `FakeMedia.sanitize` copies.
- Order in uploads and imports: probe (limits) → sanitize → probe again (stored width/height) → `put`.

- [ ] **Step 1: Write the failing tests** (real ffmpeg + sharp; fixtures built in the test into a temp dir): `a GPS-tagged rotated JPEG is stored upright without EXIF` — a 40×20 JPEG with EXIF orientation 6 and a GPS IFD → output has no `exif`, no `orientation`, is 20×40; `a located rotated MOV keeps its rotation and loses its location` — `-display_rotation 90` + `location` + `com.apple.quicktime.location.ISO6709` → output tags have no location, the bytes contain no `+14.5995`, display matrix rotation still 90. Route test: `an uploaded image is sanitized before it is stored` (spy `FakeMedia.sanitize` called with the work path).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `npm run deps -- sharp@<pinned>`; implement.
- [ ] **Step 4:** `npm run verify` → green.
- [ ] **Step 5:** Commit `feat(privacy): strip EXIF/GPS from uploads and imported media (spec row 2)`.

### Task 10: S3 storage and one-store-per-database

**Files:**
- Create: `backend/shared/s3Storage.ts`, `backend/server/boot.ts` (+ `boot.test.ts`)
- Modify: `backend/shared/storage.test.ts`, `backend/shared/pg.ts`, `database/schema/schema.sql`, `backend/server/index.ts`, `.env.example`, `package.json` (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`), `tests/integration/pg.test.ts`

**Interfaces:**
- Produces:
```ts
export class S3Storage implements Storage { constructor(o: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string; workDir: string }); ensureBucket(): Promise<void> }
// backend/server/boot.ts
export function createStorage(env: NodeJS.ProcessEnv, dataDir: string): Promise<Storage>; // S3 (ensureBucket, clear error) when S3_ENDPOINT is non-empty, else FsStorage
// backend/shared/pg.ts
export function ensureStorageMatches(pool: Pool, described: string): Promise<void>; // first boot records it; a different value throws
```
- `schema.sql`: `CREATE TABLE IF NOT EXISTS sabi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`. Mismatch message: `this database's files are in <stored>; set S3_ENDPOINT/DATA_DIR to match or use another DATABASE_URL`.
- `workDir` default `$WORK_DIR` or `join(tmpdir(), "sabi-work")`.

- [ ] **Step 1: Write the failing tests:** `storage.test.ts` runs `storageContract` against `S3Storage` (`describe.skipIf(!process.env.S3_TEST_ENDPOINT)`, bucket `sabi-test-<random>`, emptied and removed after); `boot.test.ts`: `createStorage picks files without S3_ENDPOINT and fails clearly when S3 is unreachable` (endpoint `http://127.0.0.1:1`, message names it); pg: `the database refuses a second store`.
- [ ] **Step 2:** Run (`npm run test:infra`, `npx vitest run backend/server/boot.test.ts`) → FAIL.
- [ ] **Step 3:** Implement (`forcePathStyle: true`; `write` via `Upload`; `read` with `Range: bytes=s-e`; `stat` via `HeadObject`, 404 → null; `withLocalFile` downloads to a work file and always deletes it). `index.ts`: `createStorage` + `ensureStorageMatches(pool, storage.describe())` after `applySchema`.
- [ ] **Step 4:** `npm run test:infra` → PASS; `npm run verify` → green.
- [ ] **Step 5:** Commit `feat(storage): S3-compatible store behind S3_ENDPOINT; a database keeps one store`.

### Task 11: BullMQ runner and the restart rule

**Files:**
- Create: `backend/shared/bullJobs.ts`, `backend/shared/bullJobs.test.ts`
- Modify: `backend/server/boot.ts` (+ test), `backend/server/index.ts`, `backend/app/jobs.ts` (+ a test), `backend/modules/projects/repository.ts` (`failStuck(exceptIds)`) (+ test), `infrastructure/docker/docker-compose.yml`, `Makefile`, `.env.example`, `package.json` (`bullmq`)

**Interfaces:**
- Produces:
```ts
export class BullJobRunner implements JobRunner { constructor(url: string, bus: EventBus, opts?: { queue?: string; lockMs?: number }); close(): Promise<void> } // queue "sabi-jobs", concurrency 1, attempts 1, keep finished 7 days / 200; attempt = BullMQ's start count
export function createJobRunner(redisUrl: string | undefined, bus: EventBus): Promise<JobRunner>; // ping with a 3 s timeout, clear error
export function noRerun(deps: AppDeps, handler: JobHandler): JobHandler; // attempt > 1 → status prevStatus (if still running), outputs.stale if an MP4 exists, throw Error("interrupted")
failStuck(exceptIds?: string[]): Promise<number>
```
- `registerJobHandlers` wraps `broll` and `generate` in `noRerun`. Compose: `redis` (`redis:7-alpine`, `redis-server --appendonly yes --maxmemory-policy noeviction`, `${DATA_DIR}/redis:/data`, port 6379); `api` gets `REDIS_URL: redis://redis:6379`; `make db` starts `postgres minio redis`.

- [ ] **Step 1: Write the failing tests:** `jobs.test.ts`/`app/jobs` test: `an interrupted generate job fails without calling fal again` (call the wrapped handler with `attempt: 2` → `interrupted`, `generator.calls` empty, status restored, MP4 stale), `a first attempt runs normally`. `bullJobs.test.ts` (`skipIf(!REDIS_TEST_URL)`, a random queue name, short lock): the Task 2 runner cases again; `a job interrupted by a dead worker comes back as attempt 2` (runner A takes a gated job and is closed without finishing; runner B on the same queue gets it with `attempt === 2`); `forget removes the project's finished jobs`. `boot.test.ts`: `createJobRunner without a URL is in-memory; an unreachable Redis fails clearly`. Repository: `failStuck skips the given ids`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `npm run deps -- bullmq@<pinned>`; confirm the start-count field and stalled options in the installed types before using them. Implement; `index.ts` creates the runner, calls `failStuck(ids with an active job)`, then `createApp`, then `deps.jobs.start?.()`.
- [ ] **Step 4:** `make db` (redis now up), `npm run test:infra` → PASS; `npm run verify` → green. Manual: `REDIS_URL=redis://localhost:6379 DATABASE_URL=… npm run dev:server`, start a render on the demo, save a backend file mid-render (tsx restart) → the render runs again and finishes.
- [ ] **Step 5:** Commit `feat(jobs): BullMQ runner behind REDIS_URL; restarted paid jobs fail interrupted`.

### Task 12: `build:server` and a Docker stack that renders

**Files:**
- Modify: `package.json` (`build:server`), `infrastructure/docker/Dockerfile`, `infrastructure/docker/docker-compose.yml`, `infrastructure/docker/Dockerfile.dockerignore` if needed

**Interfaces:**
- Produces: `npm run build:server` = `esbuild backend/server/index.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=dist-server/index.mjs`; api image `node:22-bookworm-slim` + `ffmpeg fonts-noto-color-emoji` + Chrome headless shell's libraries (`libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2`), `npm ci --omit=dev`, `npx remotion browser ensure`, `COPY` `dist-server shared database`; `CMD ["node", "dist-server/index.mjs"]`.

- [ ] **Step 1:** `npm run build:server` → today FAILS (top-level await under cjs). Change the script; → builds; `node dist-server/index.mjs` against `make db` (with `S3_*` + `REDIS_URL` exported) answers `/api/health`.
- [ ] **Step 2:** Check free disk (`df -h /`, `docker system df`); stop and report if under 8 GiB free.
- [ ] **Step 3:** Rewrite the `api` stage; `make up`. Done when: the demo project is seeded into MinIO, `POST /api/projects/demo/render {}` → job `COMPLETE`, the new MP4 downloads through `:8080/api/assets/<id>/file`, `ffprobe` shows 1080×1920 H.264 + AAC, and a frame with an emoji caption shows the emoji (`GET /frame`).
- [ ] **Step 4:** `docker builder prune -f`; `npm run verify` → green; `npm run render:sample` → pass.
- [ ] **Step 5:** Commit `fix(ops): build:server as ESM; Docker api image renders (ffmpeg, Chrome headless shell, emoji font)`.

### Task 13: CI

**Files:**
- Create: `.github/workflows/verify.yml`

**Interfaces:**
- Produces: workflow `verify` on `pull_request` and `push` to `main`: `ubuntu-latest`, Node 22 (npm cache), `astral-sh/setup-uv`, `sudo apt-get install -y ffmpeg`, `npm ci`, `npm run verify`, `npm run build`; `concurrency` cancels superseded runs. Action versions = their latest major tags (check with `gh api repos/<action>/releases/latest`).

- [ ] **Step 1:** Write the workflow; push the branch; open the PR as a draft so the workflow runs.
- [ ] **Step 2:** `gh run watch` → green. A failure that only CI shows (Linux paths, missing binary, macOS-only test) is fixed in the test or workflow, with a test where behaviour changes.
- [ ] **Step 3:** Commit `ci: verify and build on pull requests`.

### Task 14: Docs and hand-over

**Files:**
- Modify: `PROJECT.md`, `docs/superpowers/plans/README.md` (row 5 ✅ with a summary), `.env.example` (final pass)
- Create: Obsidian note `Captions Clone Plan 5 Execution.md`

- [ ] **Step 1:** PROJECT.md (honey-memory format): run/verify (`db:migrate`, `test:infra`, `make db` incl. redis, env switches, `make up`), decisions (ledger/cap, storage/one-store guard, queue/restart rule, sanitize), state (migration applied on 2026-10-2x, what was verified by hand, deferred minors), `last Claude session`.
- [ ] **Step 2:** `npm run verify` → green. Commit `docs: plan 5 done`.

---

## Self-review notes

- Spec coverage: row 19 → Tasks 3, 5, 6, 7; row 20 → Tasks 4, 7; row 21 → Tasks 8, 10; row 22 → Tasks 2, 11; row 23 → Tasks 1, 9, 12, 13; design "data on the SSD" → Tasks 1, 11; anti-goals → Review Focus 1–3, 5.
- Blueprint sections (design doc): folder structure and component architecture fixed by the Files lists; design system/responsive/a11y in Task 7; state (query keys) Task 7; SEO none; performance (ranges, bounded queries, one worker) Tasks 4, 8, 11; analytics no new events; deployment Tasks 1, 10–13.
