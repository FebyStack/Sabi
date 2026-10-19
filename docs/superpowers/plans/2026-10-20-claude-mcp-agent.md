# Claude MCP Editing Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code session in the desktop sidebar edits a Sabi project the way captions.ai's agent does — inspect the project, apply typed actions, look at a rendered frame to verify, re-render — through an MCP server the repo ships, on the Claude subscription alone.

**Architecture:** The MCP server (`backend/mcp`, stdio, `@modelcontextprotocol/sdk`) is a thin HTTP client of the running API (`SABI_API_URL`), never an in-process import, so it works against `dev:lite` (in-memory) and `dev:server` alike and the web preview updates over the existing SSE. Two API additions make the loop possible: a still-frame endpoint (`Renderer.renderStill`) and an atomic, optimistic-concurrency `POST /api/projects/:id/actions` that applies a typed action list — the same actions the web UI already performs one at a time. A repo skill (`.claude/skills/sabi-editor`) teaches the session the loop and the token budget.

**Tech Stack:** existing (Express 5, zod 4, Remotion 4.0.536 `renderStill`, React 19) + `@modelcontextprotocol/sdk@^1.32.1` (stdio server, `InMemoryTransport` + `Client` for tests). No model calls anywhere in the server.

**Spec:** `docs/spec.md` §11 row 10 (added 2026-10-20) and row 8d; row 7 (Ollama stays for buttons; **no Anthropic API**). Plan-2 interfaces this builds on: `shared/contract.ts` (`ProjectSchema`, `UpdatePlanInput`, `UpdatePhrasesInput`, `UpdateTemplateInput`, `api`), `backend/modules/editplan/routes.ts` (PATCH plan validation: `unknown_id`, `bad_burn_in`, re-render rule), `backend/modules/pipeline/routes.ts` + `pipeline.ts` (`startCaptionJob`, `renderOutputs`), `backend/shared/renderer.ts` (`RemotionRenderer`, `FakeRenderer`), `shared/editing/renderProps.ts` (`captionVideoProps`), `backend/shared/apiTestHelpers.ts` (`readyProject`, `untilStatus`), `backend/shared/jobs.ts` (`JobRunner.active`), `backend/modules/events/routes.ts` (SSE). Conventions: `PROJECT.md`.

## Global Constraints

- **Subscription only:** `backend/mcp` contains no LLM client, no API keys, no Anthropic SDK. It only speaks HTTP to `SABI_API_URL` (default `http://127.0.0.1:3001`). If the API is down every tool returns `isError: true` with the text `Sabi API not reachable at <url> — start it with \`npm run dev:lite\` (or the "api-lite-fake" launch config)`.
- **Token budget for tool results:** `inspect_project` defaults to a summary (≤ ~1 500 tokens: title, status, duration, language, template, counts, shot list, enabled cuts, outputs, warnings, `baseVersion`); word-level data only via `section: "phrases"` with `offset`/`limit` (default limit `40` phrases) or `search`. `render_frame` returns a PNG scaled to **`540` px on the long edge** (≈ 60–120 KB) as MCP `image` content plus one text line with the timestamp. Never return the raw project JSON.
- **Optimistic concurrency:** every mutating tool sends `baseVersion` = the project's `updatedAt` it last saw; the API answers `409 stale` with the current version when it moved (the web UI or another session edited); the tool surfaces this as text telling Claude to re-inspect. `409 busy` while a job runs is surfaced the same way, with the active job's kind and progress.
- **Actions v1** (typed, zod-validated, applied atomically — all or nothing, one `update`): `setTitle {title}`, `editPhrase {phraseId, text}` (retimed like `PhraseEditor.retimePhrase`; the server-side copy lives in `shared/captions/retime.ts`), `setCut {cutId, shouldTrim}`, `setShotKind {shotId, kind}`, `setTemplate {captionTemplateId}`, `setBurnIn {language | null}`. Max `50` actions per call; unknown ids → `400 unknown_id` naming the id; no partial application. Overlay actions arrive with plan 3.
- **Frames:** `GET /api/projects/:id/frame?t=<ms>&w=<px>` renders the **output** timeline at `t` (clamped to `[0, durationMs]`), `w` ∈ `[160, 1080]` default `540`, PNG, `cache-control: no-store`; uses `captionVideoProps` exactly like the MP4 render so what Claude sees is what exports; `409 busy` while a job runs; `400 no_captions` before the first `/run`.
- **Jobs:** `run_job` starts `captions` (`POST /run`), `plan` (`POST /plan`) or `render` (re-render with current edits = `startCaptionJob(…, {transcribe:false, resegment:false})`, exposed as `POST /api/projects/:id/render`); `wait_job` polls `GET /api/projects/:id` every `1 s` until status leaves the running set or `timeoutMs` (default `600 000`) elapses, reporting the last SSE-equivalent stage/progress it saw (from `GET /api/projects/:id/job`, new, returns `deps.jobs.active(id)`).
- **Files:** `create_project {title, path}` uploads a local file through the existing upload routes (streams, respects `UPLOAD_LIMITS`); `export_outputs {projectId, outDir}` writes `<title>.mp4/.srt/.vtt` (+ `.<lang>.srt/.vtt`) into an existing directory and returns the paths; both refuse paths outside the user's home directory.
- Registration: `.mcp.json` at the repo root: `{"mcpServers":{"sabi":{"command":"npx","args":["tsx","backend/mcp/index.ts"],"env":{"SABI_API_URL":"http://127.0.0.1:3001"}}}}`; `npm run mcp` runs the same command; `.claude/skills/sabi-editor/SKILL.md` documents the loop.
- Single wire contract (`shared/contract.ts`), TDD with colocated tests, `npm run verify` green after every task, backend imports relative, no co-author lines in commits.

## Review Focus

1. **Web UI and Claude edit the same project** — Claude's `apply_actions` with an old `baseVersion` after the user ticked a cut in the browser must not clobber it: `409 stale`, nothing applied, the tool says "re-inspect". → Task 2 test `stale baseVersion rejects the whole batch`.
2. **Claude asks for a frame while a render is running** (status `rendering`): `409 busy` with the job's kind/progress; no second Chromium render is started. → Task 1 test `frame while busy is 409`.
3. **A 10-minute transcript (~1 500 words)** — `inspect_project` summary stays small and `section: "phrases"` pages; `search: "water"` returns only matching words with times. → Task 3 test `inspect pages phrases and searches words`.
4. **Frame timestamp outside the output timeline** (after enabled cuts shortened it, or negative): clamped, never a Remotion crash; the text line reports the clamped time. → Task 1 test `frame clamps t to the output duration`.
5. **API not running / wrong port**: every tool fails fast (≤ 2 s) with the start hint, never hangs. → Task 3 test `tools report an unreachable api`.
6. **`create_project` with a file outside `$HOME` or an unsupported type, `export_outputs` into a missing directory**: refused with a clear message, nothing uploaded/written. → Task 3 test `file tools refuse bad paths`.

---

### Task 1: Still frames

**Files:**
- Create: `backend/modules/frames/routes.ts`, `backend/modules/frames/routes.test.ts`
- Modify: `backend/shared/renderer.ts`, `shared/contract.ts` (`api.projectFrame`, `api.projectJob`), `backend/app/app.ts`, `backend/modules/events/routes.ts` (add `GET /api/projects/:id/job`), `tests/integration/render.test.ts`

**Interfaces:**
- `Renderer` gains `renderStill(req: StillRequest): Promise<void>` with `StillRequest = { compositionId: "CaptionVideo"; inputProps: CaptionVideoProps; timestampMs: number; width: number; outPath: string }`; `RemotionRenderer.renderStill` uses `selectComposition` + `renderStill({ frame: Math.round(timestampMs/1000*FPS), scale: width / composition.width, imageFormat: "png", browserExecutable })` (same bundle cache as `render`); `FakeRenderer.renderStill` records the call and writes a valid 1×1 PNG (`Buffer.from(PNG_1x1_BASE64, "base64")`).
- `GET /api/projects/:id/frame?t&w` → `image/png` bytes; `400 no_captions` when `phrases` is empty; `409 busy` when `deps.jobs.active(id)`; `t` clamped to `[0, props.durationMs]` where `props = captionVideoProps(project, { videoSrc: apiBaseUrl + assetFile(source), sourceDurationMs })`; `w` clamped to `[160, 1080]`, default `540`; response header `x-sabi-frame-ms: <clamped t>`; the PNG is written to `storage` key `frames/<projectId>/<ms>-<w>.png` and served with `sendFile`; files under `frames/` are overwritten per `(ms, w)` so they never accumulate beyond what was asked.
- `GET /api/projects/:id/job` → `JobState | null` (JSON), no 404 for null.

- [ ] **Step 1: Write failing tests in `frames/routes.test.ts`** (on `readyProject`): `renders a png at t` (200, `content-type: image/png`, body starts with the PNG magic bytes, `FakeRenderer.stillCalls.at(-1)` has `timestampMs: 4000, width: 540`), `frame clamps t to the output duration` (`t=999999` → header `x-sabi-frame-ms` equals `durationMs`; `t=-5` → `0`), `frame while busy is 409` (start a gated job via `deps.jobs.enqueue`, then expect 409 `{error:"busy", job:{kind,…}}`), `frame before captions is 400`, `job endpoint returns the active job or null`. `render.test.ts` (gated): `renders a real still` asserting the PNG is > 5 KB and `w=270` yields a 270-wide image (parse the IHDR width bytes).
- [ ] **Step 2: Run `npx vitest run backend/modules/frames` — expect FAIL**
- [ ] **Step 3: Implement `renderStill` (both renderers), the two routes, the contract paths, mount the router.**
- [ ] **Step 4: Run `npm run verify` — expect PASS; run `npm run render:sample` once — expect PASS and open the PNG (captions visible).**
- [ ] **Step 5: Commit** `git commit -am "feat(frames): still-frame endpoint via Remotion renderStill; active-job endpoint"`

### Task 2: Typed actions endpoint

**Files:**
- Create: `backend/modules/actions/apply.ts`, `backend/modules/actions/apply.test.ts`, `backend/modules/actions/routes.ts`, `backend/modules/actions/routes.test.ts`
- Modify: `shared/contract.ts`, `shared/types.ts`, `backend/app/app.ts`, `backend/modules/pipeline/routes.ts` (add `POST /api/projects/:id/render`), `backend/modules/editplan/routes.ts` (extract the plan-patch validation into `backend/modules/editplan/validate.ts` so `apply.ts` reuses it — no second copy)

**Interfaces:**
- Contract: `ActionSchema = z.discriminatedUnion("type", [ setTitle{title: string.min(1).max(200)}, editPhrase{phraseId, text: string.min(1).max(500)}, setCut{cutId, shouldTrim}, setShotKind{shotId, kind: ShotKind}, setTemplate{captionTemplateId: CaptionTemplateId}, setBurnIn{language: TranslationLanguage.nullable()} ])`; `ApplyActionsInput = z.object({ baseVersion: z.string(), actions: z.array(ActionSchema).min(1).max(50), render: z.boolean().default(false) })`; `ApplyActionsResult = z.object({ project: ProjectSchema, applied: z.number(), jobId: z.string().optional() })`; `api.projectActions`, `api.projectRender`.
- `applyActions(project: Project, actions: Action[]): { patch: Partial<Project>; rerender: boolean } | { error: "unknown_id" | "bad_burn_in" | "no_plan" | "no_captions"; id?: string }` — pure, in `apply.ts`: validates every action against the project first (ids exist, burn-in language is translated, plan exists for cut/shot actions, phrases exist for `editPhrase`), then folds them into one patch; `rerender` is true when any action changes what the MP4 shows (`editPhrase`, `setCut`, `setTemplate`, `setBurnIn`; `setShotKind` only once overlays exist — false in this plan; `setTitle` false).
- `POST /api/projects/:id/actions` → `409 {error:"stale", currentVersion}` when `baseVersion !== project.updatedAt`; `409 busy` while a job runs; `400 {error, id}` from `applyActions`; else `projects.update(id, patch)`, then if `render && rerender` start `startCaptionJob(deps, updated, { transcribe:false, resegment:false })` and return `202 {project, applied, jobId}`; otherwise `200 {project, applied}`.
- `POST /api/projects/:id/render` → `202 {jobId}` (re-render current edits), `400 no_captions`, `409 busy`.

- [ ] **Step 1: Write failing tests** — `apply.test.ts` (pure, fixture project from `readyProject` snapshot): `folds mixed actions into one patch` (title + phrase edit + cut toggle + template → patch has all four, `rerender: true`), `unknown ids fail the whole batch` (one bad `cutId` among good actions → `{error:"unknown_id", id}` and no patch), `setTitle alone needs no rerender`, `setBurnIn requires a translation`. `routes.test.ts`: `applies and re-renders` (`render: true` → 202, `jobId`, project `ready` again with a new `mp4AssetId`, phrase text changed), `stale baseVersion rejects the whole batch` (edit via `PUT /phrases` first, then POST with the old version → 409 `stale`, nothing changed), `busy is 409`, `render endpoint re-renders`.
- [ ] **Step 2: Run `npx vitest run backend/modules/actions` — expect FAIL**
- [ ] **Step 3: Implement contract, `validate.ts` extraction, `apply.ts`, routes, mount.**
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(actions): atomic typed actions with optimistic concurrency; render endpoint"`

### Task 3: MCP server

**Files:**
- Create: `backend/mcp/index.ts` (stdio entry), `backend/mcp/server.ts` (`createSabiMcpServer(client)`), `backend/mcp/client.ts` (`SabiApi` HTTP client), `backend/mcp/tools.ts` (tool handlers, pure over `SabiApi`), `backend/mcp/tools.test.ts`, `backend/mcp/server.test.ts`
- Modify: `package.json` (dep `@modelcontextprotocol/sdk@^1.32.1`; script `"mcp": "tsx backend/mcp/index.ts"`), `backend/tsconfig.json` (nothing unless the SDK needs `moduleResolution` tweaks — note it in the ledger if so)

**Interfaces:**
- `SabiApi` (`client.ts`): `constructor(baseUrl: string, { timeoutMs = 2000 })`; methods wrap the contract: `listProjects()`, `getProject(id)`, `getJob(id)`, `frame(id, t, w): Promise<Buffer>`, `applyActions(id, input)`, `run(id)`, `plan(id, input)`, `render(id)`, `uploadFile(path, projectId)` (start → PUT stream → done), `setSource(id, assetId)`, `createProject(title)`, `assetFile(id): Promise<Buffer>`. Network errors / `ECONNREFUSED` → `SabiUnreachable(baseUrl)`; non-2xx → `SabiHttpError(status, body)` carrying the API's `{error, …}`.
- Tools (names, zod input schemas, result shapes) in `tools.ts`, each `async (api: SabiApi, input) => ToolResult` where `ToolResult = { text: string; image?: { data: Buffer; mimeType: "image/png" }; isError?: boolean }`:
  - `list_projects {}` → one line per project: `<id> · <title> · <status> · <m:ss> · <language>`.
  - `inspect_project { projectId, section?: "summary"|"phrases"|"plan"|"outputs" = "summary", search?: string, offset?: number = 0, limit?: number = 40 }` → `summary`: the fields listed in Global Constraints (shots as `shot-0 Hook 0:00–0:04`, cuts as `cut-3 pause 0:05.2–0:05.9 (on)`), always ending with `baseVersion: <updatedAt>`; `phrases`: `ph-<n> [m:ss.s–m:ss.s] text` for the page, with `(emoji)` and `*emphasised*` markers, plus `next offset` when more; `search`: words matching the regex (case-insensitive) as `"<word>" ph-<n> w-<n> m:ss.s–m:ss.s`; `plan`: all cuts and shots; `outputs`: asset ids + translations.
  - `render_frame { projectId, timestampMs, width?: number = 540 }` → image + `frame at <m:ss.s> (output timeline)`.
  - `apply_actions { projectId, baseVersion, actions: Action[], render?: boolean = false }` → `applied <n> action(s); baseVersion now <v>` (+ `render job <id> started` when rendering); `409 stale` → `isError` text `project changed since baseVersion <old> (now <new>); re-run inspect_project`; `409 busy` → `isError` text with the job.
  - `run_job { projectId, kind: "captions"|"plan"|"render", languages?: string[], burnInLanguage?: string|null }` → `job <id> (<kind>) started`.
  - `wait_job { projectId, timeoutMs?: number = 600000 }` → polls `getJob`/`getProject` each `1 s`; returns `status <s> after <n>s; last stage <stage> <progress>%` (+ warnings) or `isError` on `failed`/timeout.
  - `create_project { title, path }` → uploads, sets source → `project <id> created; next: run_job captions`; refuses paths outside `os.homedir()` or with a mime outside `UPLOAD_LIMITS.mimeTypes` (by extension: `.mp4 .mov .mp3 .wav`).
  - `export_outputs { projectId, outDir }` → writes `<safe title>.mp4/.srt/.vtt` and translated tracks; refuses a non-existent dir or one outside `$HOME`; returns the written paths.
- `createSabiMcpServer(api: SabiApi): McpServer` registers the eight tools with `server.registerTool(name, { description, inputSchema }, handler)` mapping `ToolResult` to MCP content (`{type:"text"}` and `{type:"image", data: base64, mimeType}`), `isError` passthrough. Every handler catches `SabiUnreachable` → the start hint, `SabiHttpError` → `isError` text `<status> <error>` with the API's extra fields.
- `index.ts`: `new StdioServerTransport()`, `SABI_API_URL` env, no console logging on stdout (stdio is the protocol; log to stderr).

- [ ] **Step 1: Write failing tests** — `tools.test.ts` against a real `createApp(makeTestDeps())` listening on port 0 with `readyProject` data: `inspect pages phrases and searches words` (summary ≤ 1 500 chars for the fixture; `section: "phrases", limit: 2` returns 2 and a `next offset`; `search: "water"` returns the word with its times), `render_frame returns png content` (`image.mimeType`, data starts with PNG magic), `apply_actions reports stale and busy as errors`, `run_job + wait_job reach ready`, `file tools refuse bad paths` (path `/etc/hosts` → refused; `.gif` → refused; export into `/nope` → refused), `tools report an unreachable api` (`SabiApi("http://127.0.0.1:1")` → each tool returns `isError` with "not reachable" in under 2 s). `server.test.ts`: `lists eight tools and round-trips inspect_project over InMemoryTransport` (SDK `Client` + `InMemoryTransport.createLinkedPair()`; `client.listTools()` names, `client.callTool({name:"inspect_project", …})` content text contains `baseVersion`).
- [ ] **Step 2: Run `npx vitest run backend/mcp` — expect FAIL**
- [ ] **Step 3: `npm i @modelcontextprotocol/sdk@^1.32.1`; implement `client.ts`, `tools.ts`, `server.ts`, `index.ts`, the npm script.**
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(mcp): Sabi MCP server — inspect, actions, frames, jobs, files"`

### Task 4: Registration, editor skill, docs

**Files:**
- Create: `.mcp.json`, `.claude/skills/sabi-editor/SKILL.md`
- Modify: `PROJECT.md`, `docs/superpowers/plans/README.md` (new row "3 (MCP agent)" ✅; B-roll row stays "paused on `worktree-broll-and-overlays`"), `.claude/launch.json` (no change needed; note the three-process recipe + the sidebar session in PROJECT.md)

**Interfaces:**
- `.mcp.json` exactly as in Global Constraints.
- `SKILL.md` frontmatter `name: sabi-editor`, `description: Edit a Sabi video project through the sabi MCP tools — inspect, apply typed actions, verify with a rendered frame, re-render, export. Use when the user asks to edit captions, cuts, shots, templates, translations or exports of a Sabi project.` Body (≤ 60 lines): the loop (`list_projects` → `inspect_project summary` → `inspect_project search/phrases` for specifics → `apply_actions` (batch, carry `baseVersion`, `render:false` while iterating) → `render_frame` at the edited time to verify → `run_job render` + `wait_job` once → `export_outputs`), the budget rules (summary first; page phrases; never ask for more than 4 frames per turn), the failure handling (`stale` → re-inspect; `busy` → `wait_job`; "not reachable" → tell the user to start `api-lite`), and three worked examples (fix a misspelling; remove the pause at 0:05; switch template to `bold` and burn in Spanish).

- [ ] **Step 1: Write `.mcp.json`, the skill, and the docs updates.**
- [ ] **Step 2: Run `npm run verify` — expect PASS. Manual check (must be done, it is the deliverable): with `FAKE_AI=1 npm run dev:lite` running, open this repo in the Claude Code desktop app, confirm the `sabi` MCP server shows 8 tools, then in that session: "list my Sabi projects", create one from `~/Desktop/Reverse Engineer/test-clip-9x16.mp4`, run captions, change the first phrase, show me the frame at 1 s, re-render, export to `~/Desktop`. Record what happened in PROJECT.md.**
- [ ] **Step 3: Commit** `git commit -am "feat(mcp): register the sabi server for Claude Code; sabi-editor skill; docs"`

---

## Self-review notes

- Spec coverage: row 10 fully (MCP server, tool loop, skill, Ollama untouched, no API); row 8d via the Claude session; row 11.1 untouched (no new UI). Overlay/generation tools are deferred to plan 3's resumption by design (row 10 says so).
- Type consistency: `Action`/`ApplyActionsInput` (Task 2) are the exact schemas `apply_actions` (Task 3) forwards; `api.projectFrame`/`projectJob`/`projectActions`/`projectRender` (Tasks 1–2) are the only paths `SabiApi` (Task 3) calls; `FakeRenderer.renderStill` (Task 1) is what Task 3's tests rely on for PNG content.
- Review Focus 1–6 each name a test (Tasks 1–3).
- Proportion: four tasks; the server is ~400 lines; the plan pins names, limits and error strings and leaves bodies to the implementer.
