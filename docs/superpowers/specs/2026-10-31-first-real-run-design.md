# Plan 7 — first real run: design (2026-10-31)

Spec rows **28–32** (`docs/spec.md`) hold the locked decisions; this document is the how. The owner answered the batch on 2026-10-31: scope = first real run; Pexels only (no fal anywhere in this plan); the web gets a services hint; Mac access approved (the one-off disk cleanup is done, the whisperX venv and Ollama may be installed, the real English run is a step of this plan). Builder: Opus 5.5, inline. Base: `main` @ 932aed7, worktree `.claude/worktrees/objective-lamarr-f09862`.

## Why

Plans 1–6 shipped captions, the edit plan, the MCP agent, B-roll, the editor, ops and the MG sandbox, and every one of them ends with "pending real run": no transcript has ever come from whisperX, no plan from Ollama, no still from Pexels. Running it today is unsafe and blind. The Mac system disk had 199 MiB free (now 4.5 GiB after the cleanup) while Remotion's Chrome profile and render chunks live in `TMPDIR` on that disk, and every provider failure collapses into one code: `WhisperXTranscriber` says `transcriber_unavailable` for a refused connection, a 30-minute timeout, a crashed sidecar and a bad language alike; `OllamaLlm` says `llm_unavailable` for a timeout; the MCP client says "Sabi API not reachable — start it" when the API merely took over 2 s. Two minors bite only for real: a `wantsVideo` flip on a plain B-roll refresh re-fetches an image beat as a paid video, and `POST /run {language: "xx"}` fails inside faster-whisper instead of answering 400. Nothing tells the web user, before a click, that whisperX or Ollama is not running.

## Goals, non-goals, anti-goals

- **Goals:** a preflight that says what is missing and why (`npm run doctor`); honest failure codes from whisperX, Ollama and the API; a render that refuses to fill the Mac disk; the web says before a click when a local service or the Pexels key is missing; a scripted, timed end-to-end run through the agent's own client, including the demo export with the MG sandbox; the first real English run done and its numbers in PROJECT.md.
- **Non-goals:** the other ~34 deferred minors (plan 8); deployment, accounts, marketing, music, zooms, resumable uploads, J/K/L, reduced motion (plans 9+); a fal run of any kind; automatic deletion of anything on the Mac; a new npm or Python dependency; a DB migration (none needed).
- **Anti-goals (a failure even if it works):** any fal call, from the doctor, the harness or a hint probe; a key value in a log, a test, a commit or a chat message; a probe from the web app that reaches Pexels or fal; a render that starts with under 2 GiB free on the temp volume; a harness that depends on a key being set to pass.

## Probe (2026-10-31, read-only; checked on the Mac)

- `/System/Volumes/Data` 199 MiB free before the cleanup; `~/Developer/.sabi-deps` held 10 checkouts (8.2 GB), `~/Developer/.sabi-tmp` 223 leftovers (1.3 GB) from the 2026-10-22 benchmarks. `makeTestDeps` (`mkdtempSync(join(tmpdir(), "cc-"))`) and `render.test.ts` never remove their dirs. Now 4.5 GiB free; `.sabi-deps` holds `main` and `objective-lamarr-f09862`.
- `uv 0.12.5`, `ffmpeg 8.1.2`, Node 22 present; no `ollama`, no `ai/transcription/.venv`, `hf/` 1 MB, no keys, no WAV. `uv.lock` exists (the venv built once in October, then went with the full ExFAT drive). `ai:whisperx` puts the venv in the repo (SabiDev image, 93 GiB free) and models in `$DATA_DIR/hf` (SSD).
- `/api/health` is `{ok, time}`; `/api/catalog`'s `available` is key presence. Boot probes exist only for S3 and Redis. The sidecar has `GET /health` → `{ok, model}`; Ollama has `GET /api/tags`.
- `RunInput.language` is `z.string().min(2).max(8)`; `run_job.language` is the 12-code `TranslationLanguage`; the web select offers 12 names.
- `labelBeats` upgrades the first `wantsVideo` beat to video in generate mode; `brollJob` keeps an overlay only when `o.media === b.media`.
- `brollSection` in `backend/mcp/tools.ts` prints "Photo:" for every stock credit; `assetLine` already picks Photo/Video.
- `apply_actions` and `generate_assets` end with `baseVersion`; `run_job` and `wait_job` do not.

## Decisions

| # | Topic | Decision |
|---|---|---|
| Q1 | Scope | First real run: doctor, error codes, disk floor, two provider minors, scratch hygiene, pipeline harness + demo export timing, services hint, the run itself. |
| Q2 | Paid checks | **Pexels only.** No fal anywhere: the harness never calls fal or `generate` and sets `mediaSource: stock` before `broll`; the doctor reports `FAL_KEY` set/unset only (never spent, never printed) and verifies `PEXELS_KEY` with one search. |
| Q3 | Web states | **Services hint.** `GET /api/health` reports whisperX, Ollama (+ model) and key presence for Pexels/fal, probes memoised 30 s, never reaching Pexels or fal; Home and the Captions / Plan / B-roll panels say what is missing before a click, phone and desktop. Rows 1, 3, 4, 5, 20 otherwise kept. |
| Q4 | Disk | 2 GiB floor on MP4 renders (`disk_low`), web and agent alike; the doctor reports and prints removal commands, never deletes (architect's reading of the recommended option; the owner approved and the implementer did the one-off cleanup by hand). No `--clean` command. |
| — | Mac access | Approved: whisperX venv into the repo (image), Ollama from the official macOS tarball into `~/SabiDev/bin`, `qwen2.5:3b` on the SSD. The implementer runs the English clip for real; Pexels only when the owner exports the key in the API's shell; the Tagalog WAV is the owner's to record. |
| — | Real-run failures (2026-10-31, after the builder check) | **Fix small, defer big:** a whisperX/Ollama failure during the run is fixed in plan 7 when it is config or a small code change — including brew Ollama as the fallback (~200 MB on the Mac disk) or `OLLAMA_MODEL=qwen2.5:7b` (4.7 GB on the SSD); anything bigger is recorded under "Deferred to plan 8" and plan 7 still ships. |
| — | Pexels in the run (2026-10-31) | **The owner starts the API:** at R4 the implementer pauses; the owner runs `PEXELS_KEY=… npm run dev:lite` in their own terminal tab and says it's up; the implementer then runs the doctor and R5 against it. |
| — | Platforms | Copy only in the web; the hint line and notices render on phone and desktop (row 1). Doctor and harness are CLI. |
| — | Privacy / consent | Nothing new leaves the machine except one Pexels search from the doctor when the key is set. No analytics event, no key printed, no prompt sent anywhere. |
| — | Exports | MP4 / SRT / VTT unchanged (row 4). The harness downloads its MP4 to a temp dir for `ffprobe` and deletes it. |
| — | Integrations | MCP tools unchanged except texts and the `language` enum; no new service, no new key, no DB column, no Docker change. |

## Constraints

- **Subscription only:** no Anthropic API, no Anthropic key, anywhere (row 10). The MCP server stays a thin client.
- **No fal in plan 7:** no code path added here may call `deps.generator`; the harness sets `setMediaSource stock` before `run_job broll`; `generate_assets` is never called; `SPEND_CAP_CENTS` is irrelevant to this plan.
- **Key handling:** the implementer never reads, echoes, pastes, commits or asks for `PEXELS_KEY`. The owner exports it in the terminal tab that runs the API (nothing loads `.env` for npm scripts) and, if they want the doctor to verify it, in the tab that runs `npm run doctor`. Doctor output prints `set` / `unset` / `verified` / `rejected (401)`, never a value or a suffix.
- **Disk:** everything large stays off the Mac: venv and `uv` cache in the SabiDev image, HF models and Ollama blobs on the SSD, the Ollama binary in `~/SabiDev/bin`. Renders refuse under 2 GiB free on the temp or scratch volume. Tests leave no temp dirs behind.
- **ExFAT small-file rule:** no new folder per project or per request on `DATA_DIR`; the harness writes nothing there itself (the API does, through existing flat scratch names). `HF_HOME` on ExFAT wastes 1 MiB per small hub-cache file (tens of MiB; accepted).
- **Owner rules:** TDD, colocated tests, `npm run verify` green before every commit; `npm run build` after web tasks; `npm run render:sample` after touching rendering; one whole-branch review at the end; commits carry no AI co-author or "Generated with" lines; never plain `npm install`; no `cd` in compound commands; no DB migration (stated).
- **House copy:** every user-facing string in this document is exact.

## How it works

### 1. `npm run doctor` (`backend/server/doctor.ts`, beside `migrate.ts`)

`runDoctor(env, io)` returns `Check[]` (`{ name, status: "ok" | "warn" | "fail", detail, hint? }`); `formatReport` prints one line per check (`ok  ffmpeg 8.1.2`, `FAIL whisperX http://localhost:8010 — not running; start it: npm run ai:whisperx`); `main` runs when the file is the entry point and exits 1 on any `fail`. `io` is injected (`statfs`, `fetch`, `exec`, `stat`, `readdir`, `worktrees`) so the unit test needs no machine.

Checks, in order:
1. **Volumes:** free bytes on the temp volume (`os.tmpdir()`, the Mac), `DATA_DIR` (exists, writable), `WORK_DIR` when set, the repo volume; `~/SabiDev` mounted; `node_modules` is a symlink into `~/Developer/.sabi-deps`. `fail` under 2 GiB on temp/scratch, `warn` under 10 GiB.
2. **Sabi's Mac footprint:** `~/Developer/.sabi-deps/<name>` folders with no `git worktree` of that name, `~/Developer/.sabi-tmp` entries older than 24 h, with their sizes and the exact `rm -rf` lines as the hint. Reported, never run.
3. **Tools:** `ffmpeg`, `uv`, the Ollama binary (`OLLAMA_BIN`, default `ollama`), Remotion's browser at `node_modules/.remotion/chrome-headless-shell` (else "the first render downloads 570 MB to the Mac disk").
4. **Services:** whisperX and Ollama through the same `health()` probes the API uses (§6); Postgres (`SELECT 1`), MinIO (`GET /minio/health/live`), Redis (`PING`) only when `DATABASE_URL` / `S3_ENDPOINT` / `REDIS_URL` are set.
5. **Keys:** `PEXELS_KEY` unset → `warn`; set → one `GET /v1/search?query=sky&per_page=1` (1 of 200 req/h) → `verified` or `rejected (401)`. `FAL_KEY` → `set` / `unset`, nothing more. `SPEND_CAP_CENTS` through `parseSpendCap` (a typo is a `fail`, as at boot).
6. **Fixture:** `ai/evaluation/fixtures/tagalog-sample.wav` present and 16 kHz mono (`ffprobe`); absent → `warn` with the recording command from `transcribe.test.ts`.

`package.json`: `"doctor": "tsx backend/server/doctor.ts"`; `ai:ollama` becomes `OLLAMA_MODELS=… "${OLLAMA_BIN:-ollama}" serve`. `.env.example` documents `OLLAMA_BIN`.

### 2. Disk floor (`backend/shared/disk.ts`)

`MIN_FREE_BYTES = 2 * 1024 ** 3`; `assertDiskRoom(paths, free)` resolves each path's free bytes and throws `Error("disk_low")` under the floor. `AppDeps.freeBytes(path)` is injected: `fs.promises.statfs` in `index.ts` and `makeMemoryDeps`, `() => Infinity` in `makeTestDeps`. `renderOutputs` calls it for `os.tmpdir()` and `dirname(outPath)` right before `renderer.render`, so a captions job keeps its transcript (saved before the render) and fails `disk_low` instead of filling the disk. Not gated: `/frame` stills (one PNG), uploads, edits, the sidecar's WAV. Copy: web `Not enough free disk for a render — free 2 GB on this Mac (npm run doctor).`; MCP `JOB_ERRORS.disk_low = "under 2 GiB free on this Mac's temp or scratch volume — free space (npm run doctor), then run it again"`.

### 3. Provider error codes

- `WhisperXTranscriber`: `AbortSignal.timeout` → `transcriber_timeout`; a 4xx → `transcriber_rejected`; connection refused, 5xx, bad JSON → `transcriber_unavailable`.
- `OllamaLlm`: timeout → `llm_timeout`; 404 → `llm_model_missing` (as today); else `llm_unavailable`.
- `SabiApi.req`: a `TimeoutError` → `SabiTimeout`; `callTool` prints `Sabi API did not answer in 2 s at <url> — it may be warming the renderer or running a job; try again` instead of the not-reachable text, which stays for refused connections.
- `wait_job` ends its text with `\nbaseVersion: <updatedAt>` (the project it just read). `run_job` does not: a queued or running job keeps changing `updatedAt` and `apply_actions` answers `409 busy` meanwhile, so any version it printed would be unusable (builder check; amends the first draft of row 29).
- whisperX `/health` must answer while a clip transcribes, or every first captions job would show "whisperX off": `server.py`'s `transcribe` becomes a plain `def` (FastAPI runs it in its threadpool; jobs are one at a time, row 22), reading the upload through `file.file`. Implementer's call (builder check).
- Web copy (`projectEvents.ts` `ERRORS`): `transcriber_unavailable: "whisperX isn't running — start it with npm run ai:whisperx."`, `transcriber_timeout: "whisperX took too long (30 min) — try a shorter clip or check the sidecar's log."`, `transcriber_rejected: "whisperX refused the spoken language — pick another in Spoken language."`, `llm_unavailable: "Ollama isn't running — start it with npm run ai:ollama."`, `llm_timeout: "Ollama took too long (10 min) — try again or a smaller model."`, `llm_model_missing: "Ollama has no model to run — ollama pull the OLLAMA_MODEL."`, `llm_invalid_output: "Ollama's answer never fit the plan format — run Plan edit again."`, `disk_low` as above.
- `JOB_ERRORS` in `tools.ts` gets the same six codes in agent voice; `SKILL.md` "When something fails" lists them.

### 4. Spoken language

`shared/lang/whisper.ts` exports `WHISPER_LANGUAGES` (Whisper's 99 codes) and `SpokenLanguage = z.enum(...)`; `RunInput.language: SpokenLanguage.nullable().optional()`; `run_job.language: SpokenLanguage` (description keeps the `tl` example). `server.py` wraps `asr().transcribe(...)` and raises `HTTPException(400, "unknown_language")` on `ValueError`, which the API reads as `transcriber_rejected`. The web select stays the 12 `LANGUAGE_NAMES`.

### 5. B-roll refresh never pays for a flip

In `brollJob`, a kept overlay matches by shot and range only (`o.shotId === b.shotId && o.startMs >= shot.startMs && o.endMs <= shot.endMs`), whatever `b.media` says. `labelBeats` receives `allowVideo: generate && (input.regenerate || !project.overlays.some((o) => o.media === "video"))`, so the one video slot is granted only by `regenerate` or when no video exists. `brollSection` prints `Photo:` or `Video:` by `o.media`. (Generate mode is tested with the fake generator only; fal is not called in this plan.)

### 6. Services hint (row 32)

- **Probes on the adapters** (architect's call): `Transcriber.health(): Promise<"ok" | "down">` (whisperX `GET /health`) and `Llm.health(): Promise<"ok" | "down" | "model_missing">` (Ollama `GET /api/tags`; `ok` when a model's `name` equals `OLLAMA_MODEL`, or `OLLAMA_MODEL` + `:latest` when it has no tag); each with `AbortSignal.timeout(1500)`; the fakes answer `ok`. The doctor calls the same two methods.
- **Route:** `GET /api/health` (extended, not a sibling — Home already polls it every 10 s) answers `{ ok: true, time, services: { whisperx, ollama, ollamaModel, stock: "ok" | "unset", generator: "ok" | "unset" } }`. `stock`/`generator` are `!!deps.stock` / `!!deps.generator`: key presence, no network. The two probes run in parallel and the result is memoised 30 s (`deps.now()`), so the Home poll costs one probe per 30 s per service. `HealthSchema` gains `services` (required; web and API ship together).
- **Web:** `useServices()` (`frontend/src/hooks/useServices.ts`: TanStack Query key `["health"]`, 10 s refetch, shared with Home). Copy, exact:
  - Home, one line under the header, hidden when everything is `ok`: items joined by ` · ` from `whisperX off`, `Ollama off`, `Ollama model missing`, `Pexels key unset` (fal is not mentioned on Home).
  - Captions panel, inside the existing `No captions yet.` notice when `whisperx === "down"`: `whisperX isn't running — start it with npm run ai:whisperx.`
  - Plan panel, a `warn` notice above **Plan edit**: `Ollama isn't running — start it with npm run ai:ollama.` or `Ollama has no <ollamaModel> — run ollama pull <ollamaModel>.`
  - B-roll panel, a `warn` notice under **Media source**: in Stock only with `stock === "unset"`: `Pexels isn't set up: add PEXELS_KEY to the API.`; in Generate with `generator === "unset"`: `fal.ai isn't set up: add FAL_KEY to the API, or switch B-roll to Stock only.` (the existing job-error strings, so one failure reads the same before and after).
  - Buttons stay enabled (row 20 parity; the owner's "don't default to restrictive"); a job that fails anyway shows its own code (§3).
- Nothing in the hint path touches Pexels or fal; no analytics event.

### 7. Test scratch hygiene

`makeTestDeps` records every dir it creates; `frontend/src/test/setup.ts` removes them in `afterAll`. `render.test.ts` removes its `render-*` dir; `tools.test.ts` removes `~/.sabi-mcp-test-*` (plan 3 minor). One unit test asserts a recorded dir is gone after cleanup.

### 8. `npm run pipeline:sample` (`tests/integration/pipeline.test.ts`)

Gated like `render:sample`: `RUN_PIPELINE=1`, else skipped. Env: `SABI_API_URL` (default `http://127.0.0.1:3001`), `SAMPLE_CLIP` (default `~/Developer/Reverse Engineer/test-clip-9x16.mp4`; absent → the describe skips with the path), `SAMPLE_LANGUAGE` (optional, passed to `run`). Everything goes through `SabiApi` (the MCP client, with `x-sabi-actor: agent`), so the run measures the real servers on the agent's own path. No client change is needed.

Steps, each timed from the job's stage transitions (poll `getJob` every 500 ms):
1. `createProject` + `uploadFile` + `setSource`.
2. `run` → `ready`; words > 0, `startMs` monotonic, `estimatedWords` printed.
3. `plan` → shots ≥ 1, a `cuts` array, ≤ 2 emphasised words per phrase. A failure prints the job error (`llm_*`) and fails the test.
4. `catalog`: Pexels available → `applyActions [setMediaSource stock]` → `broll` → overlays ≥ 1 or a `broll_not_found:*` / `no_broll_shots` warning (printed, not a failure); Pexels unavailable → `broll skipped: PEXELS_KEY unset on the API` and the step passes. **`generate` is never called; fal is never reached.**
5. `render` (scale 1) → `downloadAsset` to a temp dir → `ffprobe` duration = output ms ± 100 → dir removed.
6. `frame` at 1000 ms → PNG > 1 KB, `problems` empty.
7. Prints one table: `stage | seconds` for extract-audio, transcribe, segment, render, plan, translate (if any), label, fetch, subtitles, and the total. Pexels spends nothing; the table ends `spent 0¢`.

The project is kept, so the owner can open it in the web and edit it with Claude — for as long as that API process lives: `dev:lite` keeps projects in memory, so a restart drops it (its files stay under `DATA_DIR` until retention). The real run uses `dev:lite`, not `dev:server` (no Docker VM growth on the Mac disk); the numbers live in PROJECT.md, and the harness re-runs in minutes. Implementer's call (builder check).

### 9. Demo export timing (same file, second `describe`)

Skips unless a project `demo` exists (dev:lite seeds it). `render` at scale 1, then 2; `ffprobe` 1080×1920 and 2160×3840; prints seconds for each against the 14 s pre-sandbox baseline (PROJECT.md, 2026-10-22). Printed, not asserted: this is the measurement plan 6 left undone, and the first number for the disk floor's 4K temp peak.

### 10. The real run (plan-level steps, executed by the implementer)

Each step records its result in PROJECT.md (State → "Real run (2026-10-31)"): the doctor report, versions, install minutes and sizes, the harness table, warnings seen, and a "Deferred to plan 8" list for anything that fails.

- **R1** `npm run doctor` → paste the report. Expected fails: whisperX down, Ollama down, WAV missing; `PEXELS_KEY` unset unless the owner exported it.
- **R2** whisperX: `npm run ai:whisperx` in its own tab (launch `whisperx`). First start resolves `uv.lock` into `ai/transcription/.venv` (image, ~3 GB; minutes over USB) and downloads the `small` model into `$DATA_DIR/hf`. Record minutes, venv size, `GET /health` answer.
- **R3** Ollama: `mkdir -p ~/SabiDev/bin`, download the official macOS tarball (`https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz`) into it, extract, `xattr -dr com.apple.quarantine ~/SabiDev/bin`, `export OLLAMA_BIN=~/SabiDev/bin/ollama`, `npm run ai:ollama` in its own tab (launch `ollama`; blobs under `$DATA_DIR/ollama`), then `"$OLLAMA_BIN" pull qwen2.5:3b` (1.9 GB, through the running server so it lands on the SSD). Record the version, minutes, and that the Mac disk did not change.
- **R4** `npm run dev:lite` (real providers; not `FAKE_AI`) → `renderer warm in …`; `npm run doctor` again → green except the WAV (and Pexels unless exported).
- **R5** `npm run pipeline:sample` on the English clip → the table. Watch for `llm_model_missing` / `llm_invalid_output` / `llm_timeout` on `plan`, `timing_estimated` on captions, `broll skipped` when Pexels is not exported.
- **R6** The demo export seconds (part of R5's run) → PROJECT.md plan 6 "Not yet done" becomes done, with the numbers.
- **R7** `npm run transcribe:sample` only if the owner has recorded the WAV; otherwise PROJECT.md says it is still skipped.
- **R8** Web check (`npm run dev`, browser at 375 px and desktop): the finished project's captions, plan and B-roll; stop the sidecar, reload Home → `whisperX off`; open Captions → the notice names it.

Complete without the owner's parts: R5 passes with `broll skipped`, R7 stays skipped, and the plan still ships. The implementer never handles `PEXELS_KEY`; if it is exported in the API's shell the harness uses stock, otherwise not.

### 11. What changes for the agent (`SKILL.md`)

- `wait_job` now ends with `baseVersion`: use it instead of a fresh `inspect_project` after a job.
- Six provider codes with one line each in "When something fails"; `Sabi API did not answer in 2 s` means wait and retry, not "start the API".
- `language` must be a Whisper code (`400 invalid input` otherwise).
- A B-roll refresh keeps what is there; only `regenerate` may change the media kind.
- `disk_low`: tell the user to free space (`npm run doctor`), then run again.

## Blueprint

- **Folder structure:** `backend/server/doctor.ts` (+ `doctor.test.ts`) beside `migrate.ts`; `backend/shared/disk.ts`; `shared/lang/whisper.ts`; `frontend/src/hooks/useServices.ts`; `tests/integration/pipeline.test.ts` beside `transcribe`/`render`. Also touched: `backend/shared/{transcriber,llm,deps,testing}.ts`, `backend/server/index.ts`, `backend/app/app.ts` (health), `backend/modules/pipeline/pipeline.ts`, `backend/modules/broll/job.ts`, `backend/mcp/{client,tools}.ts`, `shared/contract.ts`, `ai/transcription/server.py`, `frontend/src/routes/router.tsx` (Home line), `frontend/src/features/editor/panels/{CaptionsPanel,PlanPanel,BrollPanel}.tsx`, `frontend/src/features/projects/hooks/projectEvents.ts`, `frontend/src/test/setup.ts`, `.claude/skills/sabi-editor/SKILL.md`, `package.json`, `.env.example`, docs.
- **Component architecture:** no new component. `useServices()` feeds one line in Home and one `Notice` in each of three panels; the error-copy map gains seven codes.
- **Backend pipeline:** step 2 (ASR) and 3 (LLM) adapters gain `health()` and three codes each; step 6 (render) gets a disk gate before `renderer.render`; `RunInput.language` is an enum at the edge; `/api/health` composes the adapters' probes with a 30 s memo.
- **Data model:** unchanged; no migration (`db:migrate` not needed).
- **Design system:** no new tokens; `Notice` tones `info`/`warn` as they exist; the Home line is `text-xs` in the warn colour.
- **Responsive:** copy only; the Home line wraps under the header at 375 px; panel notices are the existing full-width `Notice`. Checked at 375 px and desktop in R8.
- **State management:** server state only — TanStack Query key `["health"]`, 10 s refetch, shared by Home and the editor; no store, no persistence.
- **SEO:** n/a (noindex app).
- **Performance:** health probes 1.5 s timeout, parallel, memoised 30 s, so the 10 s poll adds at most two local HTTP requests per 30 s and never a remote one. The harness records seconds per stage and the demo export at 1080p/4K (sandbox cost vs 14 s). Doctor probes are one-shot.
- **Accessibility:** notices keep `role="status"` / `aria-live="polite"`; the Home line is plain text; buttons are never disabled by a hint. J/K/L and reduced motion stay deferred.
- **Analytics:** no new event; nothing in this plan reaches PostHog, Pexels (except the doctor's one verified search) or fal.
- **Deployment:** `npm run doctor` is step 0 of Run / verify; CI unchanged (the doctor's unit tests run in `verify`; its checks are machine-specific); Docker unchanged (`/api/health` inside the container probes `host.docker.internal` as the jobs do); `OLLAMA_BIN` in `.env.example`.
- **Testing:** unit (vitest, node): doctor checks with injected io (volumes, stale folders, probes, key states, fixture), disk gate (1 GiB → `disk_low`, nothing rendered), three codes per adapter with a fake fetch (abort, 404, 400, 500), `SabiTimeout` text, `baseVersion` in `wait_job`, `RunInput` rejects `xx`, B-roll refresh keeps an image when the fake LLM flips `wantsVideo` (generator never called), health route memo and shape, `useServices` consumers through `renderToStaticMarkup`, scratch cleanup. Gated: `pipeline:sample`, `render:sample` (rendering touched by the gate), `transcribe:sample` (WAV). Manual: R1–R8.

## Trade-offs

| Choice | Over | Because | Cost |
|---|---|---|---|
| Probes as `health()` on the adapters | a separate probe module | one implementation serves the doctor and `/api/health`; fakes answer `ok` for free | two interface methods |
| Extend `/api/health` | a sibling route | Home already polls it; one schema, one query key | the health poll now costs ≤ 2 local probes per 30 s |
| 30 s memo, 1.5 s timeout | probing per request | a stopped sidecar must not slow every Home poll by 30 s | a hint can lag a restart by ≤ 30 s |
| Key presence for Pexels/fal in the hint | a verifying call | the web must never reach a third party on its own; the doctor verifies Pexels once, by hand | an invalid key is found only by the doctor or a job |
| Disk floor as a job failure | refusing to boot | demo, stills and edits keep working on a full disk; the failure names the fix | one `statfs` per render |
| Fixed error codes | free-text detail | exact copy, exact tests, nothing leaks into the ledger or MCP text | a few more lines in two copy maps |
| Harness through `SabiApi` | in-process `createApp` | measures the real servers on the agent's own path | needs the API running (as `transcribe:sample` needs the sidecar) |
| Whisper's enum at the API edge | trusting the sidecar | a 400 now instead of a failed job after a WAV extract | a 99-entry list in `shared/lang/whisper.ts` |
| Ollama from `~/SabiDev/bin` | brew | the Mac disk stays untouched; blobs already live on the SSD | a tarball download and one `xattr` |
| Keep the harness's project | delete it | the owner inspects it in the web and with Claude | one project per run (30-day retention removes it) |

## Residual risks

- The cause of "the app quit twice during dev:lite exports" is unproven; the 4K demo export in R6 is the test. If it was the disk, the floor catches it; if Chrome, plan 8.
- The Ollama tarball running from the `nobrowse,noowners` SabiDev image after the quarantine strip is untested; fallback: brew, now that 4.5 GiB are free.
- `uv` resolving `uv.lock` into the image over USB: minutes, maybe ten; a torch wheel mismatch would surface here, not in tests.
- Whisper's 99 codes vs this faster-whisper pin: the sidecar's 400 covers a mismatch either way.
- `transcribe:sample`'s bounds (`tl` detected, ≤ 2 estimated words) may be too tight for the real aligner; adjust after R7, not before.
- 2 GiB is a guess at a 4K export's temp peak; R6 measures it, and the constant is one line.
- A hint can be 30 s stale after a service restarts; the job's own code is the truth.

## Left to the builder

- The doctor's exact report layout and `Check` names; whether `io` is one object or separate parameters.
- The health memo's placement (a closure in `createApp` vs a small helper); the exact `services` field names are fixed above.
- Whether `health()` is optional on the interfaces (then `/api/health` reports `ok` for an adapter without it) or required.
- Poll interval and timeouts inside the harness; how stage transitions are captured (job polling is fine).
- Where the Home line sits (under the `<header>`, before `ProjectList`) and its exact Tailwind classes.
- The order of R2/R3 and the tab layout; the PROJECT.md section wording.
