# Plan 7 — First Real Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sabi runs once for real — whisperX, Ollama, Pexels when the owner provides the key — safely (a disk floor on renders), honestly (one failure code per cause, a services hint before the click) and measurably (`npm run doctor` before, `npm run pipeline:sample` with seconds per stage during), with the numbers in PROJECT.md.

**Architecture:**
- The two local adapters (`WhisperXTranscriber`, `OllamaLlm`) gain `health()` probes and three failure codes each; `GET /api/health` composes the probes with a 30 s memo and key presence for Pexels/fal; the web reads it through one `useServices()` hook.
- A disk gate (`assertDiskRoom`) runs right before every MP4 render; `AppDeps.freeBytes` is injected so tests never touch `statfs`.
- `npm run doctor` (`backend/server/doctor.ts`) is a pure `runDoctor(env, io)` over injected io, reusing the adapters' probes; it reports and never deletes.
- `npm run pipeline:sample` drives the running API through `SabiApi` (the MCP client), so the real run goes down the agent's own path and never near fal.

**Tech Stack:** existing only — Express 5, zod 4, React 19, TanStack Query 5, Remotion 4.0.536, MCP SDK, tsx, vitest 3 (node), FastAPI (sidecar). No new dependency. `fs.promises.statfs` (Node 22).

**Spec:** `docs/superpowers/specs/2026-10-31-first-real-run-design.md` (the design) and `docs/spec.md` rows **28–32**, with rows 7 (whisperX + Ollama local; Pexels), 10 (Claude over MCP, no Anthropic API), 13 (`tl`), 20 (web and agent have the same powers), 22 (one job at a time). Builds on: `backend/shared/{transcriber,llm,deps,testing,renderer,storage}.ts`, `backend/server/{boot,index,index-lite,migrate}.ts`, `backend/app/app.ts`, `backend/modules/{pipeline,broll,usage}/`, `backend/mcp/{client,tools}.ts`, `shared/contract.ts`, `ai/transcription/server.py`, `frontend/src/{routes/router.tsx,services/http.ts,features/editor/panels/*,features/projects/hooks/projectEvents.ts}`, `tests/integration/{render,transcribe}.test.ts`. Conventions: `PROJECT.md`.

**Where to execute:** this worktree (`.claude/worktrees/objective-lamarr-f09862`), branch `claude/objective-lamarr-f09862` off `main` @ 932aed7. `node_modules` is linked (`npm run deps` done); baseline `npm run verify` = 533 passed / 49 skipped + 7 pytest. Mac disk ≈ 10 GiB free. Ollama's official tarball is extracted at `~/SabiDev/bin/ollama-dist/` (binary `~/SabiDev/bin/ollama-dist/ollama`, sha256 verified, signed by Ollama Inc); `uv sync` of `ai/transcription` into this worktree's `ai/transcription/.venv` is in progress.

## Global Constraints

- **Subscription only:** no Anthropic API, no Anthropic key anywhere (row 10).
- **No fal in plan 7:** nothing added here calls `deps.generator`; the harness sets `setMediaSource stock` before `broll` and never calls `generate`; the doctor reports `FAL_KEY` as `set`/`unset` only.
- **Key handling:** the implementer never reads, echoes, pastes, commits or asks for `PEXELS_KEY`. The owner exports it in the terminal tab that runs the API (R4 pause). Doctor output prints `set` / `unset` / `verified` / `rejected (401)`, never a value.
- **Error codes (exact):** `transcriber_unavailable | transcriber_timeout | transcriber_rejected`, `llm_unavailable | llm_timeout | llm_model_missing`, `disk_low`; `generator_*` / `stock_*` unchanged.
- **Disk floor:** `MIN_FREE_BYTES = 2 * 1024 ** 3`, checked for `os.tmpdir()` and the render's scratch folder right before `renderer.render`; `/frame`, uploads and edits are not gated.
- **Health:** `services` probes time out in **1500 ms**, run in parallel, memoised **30 000 ms**; `stock` / `generator` are key presence (`!!deps.stock`, `!!deps.generator`), never a request.
- **Copy (exact, web):** `whisperX isn't running — start it with npm run ai:whisperx.` · `whisperX took too long (30 min) — try a shorter clip or check the sidecar's log.` · `whisperX refused the spoken language — pick another in Spoken language.` · `Ollama isn't running — start it with npm run ai:ollama.` · `Ollama took too long (10 min) — try again or a smaller model.` · `Ollama has no model to run — ollama pull the OLLAMA_MODEL.` · `Ollama's answer never fit the plan format — run Plan edit again.` · `Not enough free disk for a render — free 2 GB on this Mac (npm run doctor).` · Plan panel hint: `Ollama has no <ollamaModel> — run ollama pull <ollamaModel>.` · Home line items: `whisperX off`, `Ollama off`, `Ollama model missing`, `Pexels key unset`, joined by ` · `. Existing strings reused: `Pexels isn't set up: add PEXELS_KEY to the API.`, `fal.ai isn't set up: add FAL_KEY to the API, or switch B-roll to Stock only.`
- **Copy (exact, MCP):** timeout `Sabi API did not answer in <n> s at <url> — it may be warming the renderer or running a job; try again`; `wait_job` ends with `\nbaseVersion: <updatedAt>`; `run_job` does not.
- **Spoken language:** `SpokenLanguage = z.enum(WHISPER_LANGUAGES)` (99 codes, Task 3) is the only accepted `language` on `POST /run` and `run_job`; the sidecar answers `400 {"detail":"unknown_language"}`.
- **Scratch:** no new folder per project or request under `DATA_DIR`; tests remove every temp dir they make.
- **Owner rules:** TDD, colocated tests, `npm run verify` green before every commit; `npm run build` after web tasks; `npm run render:sample` after Task 4 (the render path changes); one whole-branch review at the end; commits carry no `Co-Authored-By` or "Generated with" lines (`.githooks/commit-msg` strips them anyway); never plain `npm install`; no `cd` in compound shell commands; **no DB migration** (no schema change).

## Review Focus

Five conditions the spec implies that a user will hit; each is pinned by a test in the task named.
1. **A hung sidecar must not read as "whisperX off"** while a captions job runs, and a hung probe must not stall the health route — Task 1 makes `transcribe` a plain `def` (so `/health` answers mid-clip) and pins `health()` to answer `down` within 1.5 s on a server that never replies; Task 2 pins the 30 s memo.
2. **A disk-low render must leave the transcript and the old MP4 intact** and fail with `disk_low`, nothing written (Task 4 test: renderer never called, status `failed`, outputs unchanged, `/frame` still answers).
3. **A B-roll refresh after Ollama changes its mind must spend nothing** (Task 5 test: `wantsVideo` flips onto an existing image beat → generator calls unchanged, overlays identical, credits identical; `regenerate` then does pay).
4. **A key must never appear in doctor output** (Task 9 test: `formatReport` of a run with `PEXELS_KEY=abc123` contains no `abc123`; the Pexels probe sends the key only in the `authorization` header).
5. **The services hint must never disable a control** (Task 7 tests: the Generate / Plan edit / Add B-roll buttons keep `disabled={busy}` semantics with every hint shown).

---

### Task 1: Adapter probes and failure codes (whisperX, Ollama, sidecar)

**Files:**
- Modify: `backend/shared/transcriber.ts`, `backend/shared/llm.ts`, `ai/transcription/server.py`
- Test: `backend/shared/transcriber.test.ts`, `backend/shared/llm.test.ts`

**Interfaces — Produces:**
- `Transcriber.health(): Promise<"ok" | "down">` — `WhisperXTranscriber`: `GET ${baseUrl}/health`, `AbortSignal.timeout(1500)`, `ok` on 2xx; `FakeTranscriber`: `"ok"`.
- `Llm.health(): Promise<{ status: "ok" | "down" | "model_missing"; model: string }>` — `OllamaLlm`: `GET ${baseUrl}/api/tags`, 1500 ms; `ok` when some `models[].name` equals `model` or `${model}:latest`; a 2xx without it → `model_missing`; anything else → `down`. `FakeLlm`: `{ status: "ok", model: "fake" }`.
- `WhisperXTranscriber.transcribe` throws `transcriber_timeout` (the fetch's `TimeoutError`), `transcriber_rejected` (status 400–499), else `transcriber_unavailable`.
- `OllamaLlm.chat` throws `llm_timeout` (`TimeoutError`), `llm_model_missing` (404, as today), else `llm_unavailable`.

- [ ] **Step 1: Write the failing tests**

In `backend/shared/transcriber.test.ts` (the `serve` helper exists; add a hung server that never answers):

```ts
const hang = (): Promise<{ server: Server; url: string }> => new Promise((resolve) => {
  const server = createServer(() => {}); // never answers
  server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
});

it("tells a timeout, a rejection and a down sidecar apart", async () => {
  const hung = await hang();
  await expect(new WhisperXTranscriber(hung.url, { timeoutMs: 200 }).transcribe(__filename)).rejects.toThrow("transcriber_timeout");
  hung.server.close();
  const bad = await serve(400, JSON.stringify({ detail: "unknown_language" }));
  await expect(new WhisperXTranscriber(bad.url).transcribe(__filename, { language: "xx" })).rejects.toThrow("transcriber_rejected");
  bad.server.close();
  const crashed = await serve(500, "boom");
  await expect(new WhisperXTranscriber(crashed.url).transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
  crashed.server.close();
  await expect(new WhisperXTranscriber("http://127.0.0.1:1").transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
});

it("health() is ok on a 2xx /health, down when refused, down within 1.5 s when hung", async () => {
  const up = await serve(200, JSON.stringify({ ok: true, model: "small" }));
  expect(await new WhisperXTranscriber(up.url).health()).toBe("ok");
  up.server.close();
  expect(await new WhisperXTranscriber("http://127.0.0.1:1").health()).toBe("down");
  const hung = await hang();
  const t0 = Date.now();
  expect(await new WhisperXTranscriber(hung.url).health()).toBe("down"); // the 1500 ms probe timeout, not the 30 min transcribe one
  expect(Date.now() - t0).toBeLessThan(2500);
  hung.server.close();
  expect(await new FakeTranscriber({ language: "en", words: [] }).health()).toBe("ok");
});
```

In `backend/shared/llm.test.ts`: change the existing case "maps 500, a bad body, timeout and a down server to llm_unavailable" so the hung server (`uHung`, `timeoutMs: 200`) expects `"llm_timeout"`, and add:

```ts
it("health() reads /api/tags for the configured model", async () => {
  const tags = (names: string[]) => JSON.stringify({ models: names.map((name) => ({ name })) });
  const has = await serve(200, tags(["qwen2.5:3b", "llama3:latest"]));
  expect(await new OllamaLlm(has.url, "qwen2.5:3b").health()).toEqual({ status: "ok", model: "qwen2.5:3b" });
  expect(await new OllamaLlm(has.url, "llama3").health()).toEqual({ status: "ok", model: "llama3" }); // bare name matches :latest
  expect(await new OllamaLlm(has.url, "qwen2.5:7b").health()).toEqual({ status: "model_missing", model: "qwen2.5:7b" });
  has.server.close();
  expect(await new OllamaLlm("http://127.0.0.1:1", "m").health()).toEqual({ status: "down", model: "m" });
  expect(await new FakeLlm(() => ({})).health()).toEqual({ status: "ok", model: "fake" });
});
```

(`serve` in `llm.test.ts` parses the request body as JSON; a GET has none — make `seen.body = raw ? JSON.parse(raw) : undefined`.)

- [ ] **Step 2: Run** `npx vitest run backend/shared/transcriber.test.ts backend/shared/llm.test.ts` → FAIL (`health is not a function`, wrong codes).

- [ ] **Step 3: Implement.**
  - `transcriber.ts`: add `health()` to the interface and both classes; in `transcribe`, catch the fetch separately (`err.name === "TimeoutError"` → `transcriber_timeout`, else `transcriber_unavailable`), then `if (res.status >= 400 && res.status < 500) throw new Error("transcriber_rejected")`, `if (!res.ok) throw unavailable()`.
  - `llm.ts`: the `.catch` on fetch becomes `(err: Error) => { throw new Error(err.name === "TimeoutError" ? "llm_timeout" : "llm_unavailable"); }`; add `health()` to the interface and both classes.
  - `ai/transcription/server.py`: `transcribe` becomes a plain `def` (FastAPI runs it in its threadpool, so `/health` answers while a clip transcribes), reads `file.file.read()`, and wraps the ASR call:
    ```python
    try:
        result = asr().transcribe(audio, batch_size=8, language=language)
    except ValueError as err:  # faster-whisper: unknown language code
        raise HTTPException(status_code=400, detail="unknown_language") from err
    ```
    (`from fastapi import HTTPException`). `npm run test:py` is unaffected (it imports `timing.py` only).

- [ ] **Step 4: Run** the two files → PASS; `npm run verify` → green (the `pipeline`/`editplan` tests still see `transcriber_unavailable` from fakes that throw it).

- [ ] **Step 5: Commit** `feat(providers): health probes and three failure codes each for whisperX and Ollama; sidecar answers 400 on an unknown language`

---

### Task 2: `GET /api/health` reports services (row 32, API side)

**Files:**
- Create: `backend/app/health.ts`
- Modify: `shared/contract.ts` (`ServicesSchema`, `HealthSchema`), `shared/types.ts` (`Services`, `Health`), `backend/app/app.ts`
- Test: `backend/app/health.test.ts` (new), `backend/app/app.test.ts` (the `health` case)

**Interfaces — Consumes:** Task 1 `health()`. **Produces:**
- `shared/contract.ts`:
  ```ts
  export const ServicesSchema = z.object({
    whisperx: z.enum(["ok", "down"]), ollama: z.enum(["ok", "down", "model_missing"]), ollamaModel: z.string(),
    stock: z.enum(["ok", "unset"]), generator: z.enum(["ok", "unset"]),
  });
  export const HealthSchema = z.object({ ok: z.literal(true), time: z.string(), services: ServicesSchema });
  ```
- `shared/types.ts`: `export type Services = z.infer<typeof ServicesSchema>; export type Health = z.infer<typeof HealthSchema>;`
- `backend/app/health.ts`: `export const SERVICES_TTL_MS = 30_000;` `export function servicesProbe(deps: Pick<AppDeps, "transcriber" | "llm" | "stock" | "generator" | "now">): () => Promise<Services>` — memoised by `deps.now()`; the two probes via `Promise.all`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/app/health.test.ts
import { FakeLlm } from "../shared/llm";
import { makeTestDeps } from "../shared/testing";
import { FakeTranscriber } from "../shared/transcriber";
import { SERVICES_TTL_MS, servicesProbe } from "./health";

it("reports every service and key presence", async () => {
  const deps = makeTestDeps({ generator: null });
  expect(await servicesProbe(deps)()).toEqual({ whisperx: "ok", ollama: "ok", ollamaModel: "fake", stock: "ok", generator: "unset" });
});

it("memoises the probes for 30 s", async () => {
  let t = 0;
  const transcriber = new FakeTranscriber({ language: "en", words: [] });
  const health = vi.spyOn(transcriber, "health");
  const probe = servicesProbe(makeTestDeps({ transcriber, now: () => new Date(t) }));
  await probe(); await probe();
  expect(health).toHaveBeenCalledTimes(1);
  t = SERVICES_TTL_MS;
  await probe();
  expect(health).toHaveBeenCalledTimes(2);
});

it("a down transcriber and a missing model show as such", async () => {
  const transcriber = new FakeTranscriber({ language: "en", words: [] });
  transcriber.health = async () => "down";
  const llm = new FakeLlm(() => ({}));
  llm.health = async () => ({ status: "model_missing", model: "qwen2.5:3b" });
  expect(await servicesProbe(makeTestDeps({ transcriber, llm }))()).toMatchObject({ whisperx: "down", ollama: "model_missing", ollamaModel: "qwen2.5:3b" });
});
```

In `backend/app/app.test.ts` `health`: the body now `toMatchObject({ ok: true, services: { whisperx: "ok", ollama: "ok", stock: "ok", generator: "ok" } })` and `HealthSchema.parse(res.body)` succeeds.

- [ ] **Step 2: Run** `npx vitest run backend/app` → FAIL (module missing / `services` undefined).

- [ ] **Step 3: Implement** `health.ts` (a closure holding `{ at: number; value: Promise<Services> } | null`), the schemas, and in `createApp`: `const services = servicesProbe(deps);` and `app.get(api.health, async (_req, res) => res.json({ ok: true, time: deps.now().toISOString(), services: await services() }));`.

- [ ] **Step 4: Run** `npm run verify` → green (`frontend/src/services/http.ts` parses `HealthSchema`; its tests use fixtures — update any health fixture to carry `services`).

- [ ] **Step 5: Commit** `feat(health): /api/health reports whisperX, Ollama (+model) and key presence, memoised 30 s`

---

### Task 3: Spoken language is Whisper's code list (row 29)

**Files:**
- Create: `shared/lang/whisper.ts`
- Modify: `shared/contract.ts` (`SpokenLanguage`, `RunInput`), `backend/mcp/tools.ts` (`run_job.language`)
- Test: `shared/lang/whisper.test.ts` (new), `backend/modules/pipeline/routes.test.ts`, `backend/mcp/tools.test.ts`

**Interfaces — Produces:**
- `shared/lang/whisper.ts`: `export const WHISPER_LANGUAGES = [ /* 99 codes below */ ] as const;`
- `shared/contract.ts`: `export const SpokenLanguage = z.enum(WHISPER_LANGUAGES);` `export const RunInput = z.object({ language: SpokenLanguage.nullable().optional() });`
- `tools.ts`: `language: SpokenLanguage.optional().describe(...)` (same description, `tl` example kept).

The 99 codes, exactly as Whisper spells them (no `yue`, no `fil` — Tagalog is `tl`):
```
en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su
```

- [ ] **Step 1: Write the failing tests**

```ts
// shared/lang/whisper.test.ts
import { LANGUAGE_NAMES, RunInput, SpokenLanguage } from "../contract";
import { WHISPER_LANGUAGES } from "./whisper";

it("is Whisper's 99 codes, covers every translation language, and RunInput rejects the rest", () => {
  expect(WHISPER_LANGUAGES).toHaveLength(99);
  expect(new Set(WHISPER_LANGUAGES).size).toBe(99);
  for (const code of Object.keys(LANGUAGE_NAMES)) expect(SpokenLanguage.safeParse(code).success, code).toBe(true);
  expect(RunInput.safeParse({ language: "tl" }).success).toBe(true);
  expect(RunInput.safeParse({ language: null }).success).toBe(true);
  expect(RunInput.safeParse({}).success).toBe(true);
  for (const bad of ["xx", "fil", "yue", "english", ""]) expect(RunInput.safeParse({ language: bad }).success, bad).toBe(false);
});
```

`backend/modules/pipeline/routes.test.ts`: `POST /run {language: "xx"}` → `400 {error: "invalid_input"}` and no job (`GET /job` is `null`). `backend/mcp/tools.test.ts`: `callTool(api, "run_job", { projectId, kind: "captions", language: "xx" })` → `isError`, text starts `invalid input: language`.

- [ ] **Step 2: Run** `npx vitest run shared/lang backend/modules/pipeline backend/mcp/tools.test.ts` → FAIL.

- [ ] **Step 3: Implement** the list and the two enum uses. `isTagalog` (`shared/lang/tagalog.ts`) still accepts `fil` for stored projects; nothing else changes.

- [ ] **Step 4: Run** `npm run verify` → green.

- [ ] **Step 5: Commit** `feat(captions): spoken language must be a Whisper code (POST /run and run_job answer 400 instead of a failed job)`

---

### Task 4: Disk floor on MP4 renders (row 30)

**Files:**
- Create: `backend/shared/disk.ts`
- Modify: `backend/shared/deps.ts` (`freeBytes`), `backend/shared/testing.ts` (both factories), `backend/server/index.ts`, `backend/modules/pipeline/pipeline.ts` (`renderOutputs`), `backend/mcp/tools.ts` (`JOB_ERRORS.disk_low`), `frontend/src/features/projects/hooks/projectEvents.ts` (`ERRORS.disk_low`)
- Test: `backend/shared/disk.test.ts` (new), `backend/modules/pipeline/routes.test.ts`

**Interfaces — Produces:**
- `backend/shared/disk.ts`:
  ```ts
  export const MIN_FREE_BYTES = 2 * 1024 ** 3;
  export const freeBytesOf = (path: string) => statfs(path).then((s) => s.bavail * s.bsize); // node:fs/promises
  export async function assertDiskRoom(freeBytes: (path: string) => Promise<number>, paths: string[]): Promise<void>; // throws Error("disk_low")
  ```
- `AppDeps.freeBytes: (path: string) => Promise<number>` — `freeBytesOf` in `index.ts` and `makeMemoryDeps`; `async () => Infinity` in `makeTestDeps`.
- `renderOutputs`: `await assertDiskRoom(deps.freeBytes, [tmpdir(), dirname(outPath)]);` immediately before `deps.renderer.render(...)` (inside the `try`, so the `rm` still runs).

- [ ] **Step 1: Write the failing tests**

```ts
// backend/shared/disk.test.ts
import { MIN_FREE_BYTES, assertDiskRoom, freeBytesOf } from "./disk";

it("throws disk_low when any volume is under the floor, and checks every path", async () => {
  const asked: string[] = [];
  const free = async (p: string) => { asked.push(p); return p === "/scratch" ? MIN_FREE_BYTES - 1 : MIN_FREE_BYTES; };
  await expect(assertDiskRoom(free, ["/tmp", "/scratch"])).rejects.toThrow("disk_low");
  expect(asked).toEqual(["/tmp", "/scratch"]);
  await expect(assertDiskRoom(async () => MIN_FREE_BYTES, ["/tmp"])).resolves.toBeUndefined();
  expect(await freeBytesOf(process.cwd())).toBeGreaterThan(0);
});
```

In `backend/modules/pipeline/routes.test.ts`:

```ts
it("a render refuses to start under 2 GiB free, keeps the transcript and the old MP4, and stills still work", async () => {
  const deps = makeTestDeps();
  const { a, project } = await readyProject(deps);
  deps.freeBytes = async () => 1024 ** 3;
  const renders = (deps.renderer as FakeRenderer).calls.length;
  expect((await request(a).post(`/api/projects/${project.id}/render`).send({})).status).toBe(202);
  await vi.waitFor(async () => expect((await request(a).get(`/api/projects/${project.id}/job`)).body).toMatchObject({ state: "FAILED", error: "disk_low" }), { timeout: 5000 });
  const after = (await request(a).get(`/api/projects/${project.id}`)).body as Project;
  expect(after.status).toBe("failed");
  expect(after.outputs.mp4AssetId).toBe(project.outputs.mp4AssetId);
  expect(after.phrases).toEqual(project.phrases);
  expect((deps.renderer as FakeRenderer).calls).toHaveLength(renders);
  expect((await request(a).get(`/api/projects/${project.id}/frame?t=1000`)).status).toBe(200); // stills are not gated
});
```

Copy tests: `projectEvents.test.ts` `jobErrorText("disk_low")` equals the web string in Global Constraints; `tools.test.ts`: a job failing `disk_low` → `wait_job` text contains `under 2 GiB free on this Mac's temp or scratch volume — free space (npm run doctor), then run it again` (fail it via `holdJob`'s pattern: register a `render` handler that throws `new Error("disk_low")`).

- [ ] **Step 2: Run** `npx vitest run backend/shared/disk.test.ts backend/modules/pipeline` → FAIL.

- [ ] **Step 3: Implement** as in Interfaces. `JOB_ERRORS.disk_low = "under 2 GiB free on this Mac's temp or scratch volume — free space (npm run doctor), then run it again"`; `ERRORS.disk_low = "Not enough free disk for a render — free 2 GB on this Mac (npm run doctor)."`.

- [ ] **Step 4: Run** `npm run verify` → green; then `npm run render:sample` (the render path changed; the real renders must still pass: 22/22).

- [ ] **Step 5: Commit** `feat(render): refuse an MP4 render under 2 GiB free on the temp or scratch volume (disk_low)`

---

### Task 5: B-roll refresh never pays for a label flip (row 31)

**Files:**
- Modify: `backend/modules/broll/job.ts`, `backend/mcp/tools.ts` (`brollSection` credit)
- Test: `backend/modules/broll/routes.test.ts`, `backend/mcp/tools.test.ts`

**Interfaces — Produces:** in `brollJob`, `keep` matches `o.shotId === b.shotId && o.startMs >= shot.startMs && o.endMs <= shot.endMs` (no `media` test); `labelBeats(..., { allowVideo: generate && (input.regenerate || !project.overlays.some((o) => o.media === "video")) })`. `brollSection`: `(${o.media === "video" ? "Video" : "Photo"}: ${o.attribution.author} / Pexels)`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/modules/broll/routes.test.ts
it("a refresh keeps an image beat even when Ollama now wants a video; only regenerate pays for one", async () => {
  let flip = false;
  const llm = new FakeLlm((req) => {
    const out = fakeLlmResponder(req) as { labels?: { i: number; wantsVideo: boolean }[] };
    if (out.labels) out.labels = out.labels.map((l) => ({ ...l, wantsVideo: flip && l.i === 0 }));
    return out;
  });
  const deps = makeTestDeps({ llm });
  const { a, project } = await plannedProject(deps, "generate");
  const first = await broll(a, project.id);
  expect(first.overlays.map((o) => o.media)).toEqual(["image", "image"]);
  expect(first.creditsUsedCents).toBe(2);
  flip = true;
  const again = await broll(a, project.id);
  expect(again.overlays.map((o) => [o.id, o.assetId, o.media])).toEqual(first.overlays.map((o) => [o.id, o.assetId, o.media]));
  expect(again.creditsUsedCents).toBe(2);
  expect((deps.generator as FakeGenerator).calls).toHaveLength(2);
  const fresh = await broll(a, project.id, { regenerate: true });
  expect(fresh.overlays.map((o) => o.media)).toEqual(["video", "image"]);
  expect(fresh.creditsUsedCents).toBe(2 + 25 + 1);
});
```

(`FakeLlm`, `fakeLlmResponder` from `../../shared/llm` and `../../shared/testing`.) In `tools.test.ts`: after `brollProject`-style setup, set `overlays[1]` to `media: "video", attribution: VID1.attribution` via `deps.projects.update`, then `inspect_project {section: "broll"}` contains `(Video: Vid Eo / Pexels)` and `(Photo: Jane Doe / Pexels)`.

- [ ] **Step 2: Run** `npx vitest run backend/modules/broll backend/mcp/tools.test.ts` → FAIL (a 25 ¢ video is fetched on the refresh; "Photo:" for the video).

- [ ] **Step 3: Implement** the two lines in `job.ts` and the credit label.

- [ ] **Step 4: Run** `npm run verify` → green (the existing "refresh keeps matching overlays and regenerate replaces them" case still passes).

- [ ] **Step 5: Commit** `fix(broll): a refresh keeps existing overlays whatever the new label says; the video slot needs regenerate; Video: credit`

---

### Task 6: MCP texts — timeout vs unreachable, `baseVersion` after `wait_job`, the new codes

**Files:**
- Modify: `backend/mcp/client.ts` (`SabiTimeout`), `backend/mcp/tools.ts` (`callTool`, `wait_job`, `JOB_ERRORS`), `.claude/skills/sabi-editor/SKILL.md` ("When something fails", "The loop" step 6)
- Test: `backend/mcp/tools.test.ts`

**Interfaces — Produces:**
- `client.ts`: `export class SabiTimeout extends Error { constructor(readonly baseUrl: string, readonly timeoutMs: number) }`; `req` throws it when the fetch rejects with `err.name === "TimeoutError"`, `SabiUnreachable` otherwise.
- `tools.ts`: `callTool` → `fail(\`Sabi API did not answer in ${e.timeoutMs / 1000} s at ${e.baseUrl} — it may be warming the renderer or running a job; try again\`)`; `wait_job` appends `\nbaseVersion: ${p.updatedAt}` to both its success and failure text; `JOB_ERRORS` adds `transcriber_unavailable: "whisperX is not running — ask the user to start it (npm run ai:whisperx)"`, `transcriber_timeout: "whisperX did not finish in 30 min — try a shorter clip or check the sidecar's log"`, `transcriber_rejected: "whisperX refused the spoken language — run_job captions with another Whisper code, or none to auto-detect"`, `llm_unavailable: "Ollama is not running — ask the user to start it (npm run ai:ollama)"`, `llm_timeout: "Ollama did not answer in 10 min — try again, or a smaller OLLAMA_MODEL"`, `llm_model_missing: "Ollama has no OLLAMA_MODEL to run — ask the user to ollama pull it"`, `llm_invalid_output: "Ollama's answers never fit the plan format — run_job plan again"`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a slow API is 'did not answer', not 'not reachable'", async () => {
  const hung = createServer(() => {}).listen(0);
  const url = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
  const res = await callTool(new SabiApi(url, { timeoutMs: 1000 }), "list_projects", {});
  hung.close();
  expect(res.isError).toBe(true);
  expect(res.text).toBe(`Sabi API did not answer in 1 s at ${url} — it may be warming the renderer or running a job; try again`);
});

it("wait_job ends with the project's baseVersion; run_job does not", async () => {
  const started = await callTool(api, "run_job", { projectId: project.id, kind: "render" });
  expect(started.text).not.toContain("baseVersion");
  const waited = await callTool(api, "wait_job", { projectId: project.id });
  const p = (await deps.projects.get(project.id))!;
  expect(waited.text).toMatch(new RegExp(`\\nbaseVersion: ${p.updatedAt}$`));
});

it("wait_job explains provider failures", async () => {
  deps.jobs.handle("plan", async () => { throw new Error("llm_model_missing"); });
  await callTool(api, "run_job", { projectId: project.id, kind: "plan" });
  const res = await callTool(api, "wait_job", { projectId: project.id });
  expect(res.isError).toBe(true);
  expect(res.text).toContain("Ollama has no OLLAMA_MODEL to run — ask the user to ollama pull it");
});
```

- [ ] **Step 2: Run** `npx vitest run backend/mcp/tools.test.ts` → FAIL.

- [ ] **Step 3: Implement** as in Interfaces; `SKILL.md`: step 6 of "The loop" says `wait_job` ends with `baseVersion` (use it instead of a fresh `inspect_project`); "When something fails" gets one line per new code plus `Sabi API did not answer in 2 s …` = wait and retry, `disk_low` = tell the user to free space (`npm run doctor`); `language` must be a Whisper code.

- [ ] **Step 4: Run** `npm run verify` → green.

- [ ] **Step 5: Commit** `feat(mcp): timeout told apart from unreachable; wait_job ends with baseVersion; agent text for every provider code`

---

### Task 7: Web — error copy and the services hint (row 32, web side)

**Files:**
- Create: `frontend/src/hooks/useServices.ts`
- Modify: `frontend/src/features/projects/hooks/projectEvents.ts` (`ERRORS`), `frontend/src/routes/router.tsx` (Home line), `frontend/src/features/editor/EditorPage.tsx` (pass `services`), `frontend/src/features/editor/panels/{CaptionsPanel,PlanPanel,BrollPanel}.tsx`
- Test: `frontend/src/hooks/useServices.test.ts` (new), `frontend/src/features/projects/hooks/projectEvents.test.ts`, the three panel tests

**Interfaces — Consumes:** `Services` (Task 2), `getHealth` (`frontend/src/services/http.ts`). **Produces:**
- `useServices.ts`: `export function useServices(): Services | undefined` (`useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 10_000 })`, returns `data?.services`); `export function servicesLine(s: Services | undefined): string | null` (`null` when undefined or all ok; else the items from Global Constraints joined by ` · `).
- Panels take `services?: Services` (EditorPage: `const services = useServices();` once, passed to the three). Home keeps its own `["health"]` query for `api: ok` and adds `servicesLine(health.data?.services)`; TanStack Query dedupes the two by key.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/hooks/useServices.test.ts
import { servicesLine } from "./useServices";
const ok = { whisperx: "ok", ollama: "ok", ollamaModel: "qwen2.5:3b", stock: "ok", generator: "ok" } as const;
it("servicesLine names what is missing, nothing when all ok or unknown", () => {
  expect(servicesLine(undefined)).toBeNull();
  expect(servicesLine(ok)).toBeNull();
  expect(servicesLine({ ...ok, whisperx: "down", ollama: "model_missing", stock: "unset" })).toBe("whisperX off · Ollama model missing · Pexels key unset");
  expect(servicesLine({ ...ok, ollama: "down", generator: "unset" })).toBe("Ollama off"); // fal is not on Home
});
```

`projectEvents.test.ts`: `jobErrorText` for each of the seven new codes equals the exact web copy (Global Constraints).

Panel tests (each follows its file's `renderToStaticMarkup` + `withProps` pattern):
- `CaptionsPanel.test.tsx`: with no phrases and `services.whisperx === "down"` the HTML contains `whisperX isn&#x27;t running — start it with npm run ai:whisperx.` and the `Generate captions` action is still present (`withProps((p) => p.action?.label === "Generate captions")`); with `"ok"` the string is absent.
- `PlanPanel.test.tsx`: with `services.ollama === "model_missing"` the HTML contains `Ollama has no qwen2.5:3b — run ollama pull qwen2.5:3b.` and the `Plan edit` button is not disabled; with `"down"` it contains `Ollama isn&#x27;t running — start it with npm run ai:ollama.`
- `BrollPanel.test.tsx`: `mediaSource: "stock"` + `stock: "unset"` → `Pexels isn&#x27;t set up: add PEXELS_KEY to the API.`; `mediaSource: "generate"` + `generator: "unset"` → the fal string; `stock: "ok"` → neither.

- [ ] **Step 2: Run** `npx vitest run frontend/src/hooks frontend/src/features/editor/panels frontend/src/features/projects/hooks` → FAIL.

- [ ] **Step 3: Implement.** Home: `const services = useServices(); const line = servicesLine(services);` → `{line && <p className="mb-4 text-xs text-warn">{line}</p>}` between `<header>` and `<ProjectList />`. Captions: the hint inside the existing `No captions yet.` notice (`No captions yet. whisperX isn't running — …`). Plan: a `<Notice tone="warn">` above the buttons when `services?.ollama !== "ok"` (and defined). B-roll: a `<Notice tone="warn">` right under `Segmented`. No `disabled` changes anywhere.

- [ ] **Step 4: Run** `npm run verify` → green; `npm run build` → green.

- [ ] **Step 5: Commit** `feat(web): services hint before the click (Home line, Captions/Plan/B-roll notices) and copy for every provider code`

---

### Task 8: Test scratch hygiene

**Files:**
- Create: `backend/shared/testDirs.ts`
- Modify: `backend/shared/testing.ts` (`makeTestDeps` tracks its dir), `frontend/src/test/setup.ts`, `tests/integration/render.test.ts` (`afterAll` removes `dir`)
- Test: `backend/shared/testDirs.test.ts` (new)

**Interfaces — Produces:** `testDirs.ts`: `export function trackTestDir(dir: string): string` (returns `dir`), `export function cleanupTestDirs(): void` (`rmSync(..., { recursive: true, force: true })` for each tracked dir, then forgets them). No imports beyond `node:fs`, so `setup.ts` stays light.

- [ ] **Step 1: Write the failing test**

```ts
// backend/shared/testDirs.test.ts
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTestDirs, trackTestDir } from "./testDirs";

it("removes every tracked dir and forgets it", () => {
  const dir = trackTestDir(mkdtempSync(join(tmpdir(), "cc-track-")));
  expect(existsSync(dir)).toBe(true);
  cleanupTestDirs();
  expect(existsSync(dir)).toBe(false);
  cleanupTestDirs(); // nothing to do, no throw
});
```

- [ ] **Step 2: Run** `npx vitest run backend/shared/testDirs.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**; `makeTestDeps`: `storage: new FsStorage(trackTestDir(mkdtempSync(join(tmpdir(), "cc-"))))`; `setup.ts`: `import { cleanupTestDirs } from "../../../backend/shared/testDirs"; afterAll(cleanupTestDirs);`; `render.test.ts` `afterAll(() => { server.close(); canary.close(); rmSync(dir, { recursive: true, force: true }); })`. (`tools.test.ts` already removes `~/.sabi-mcp-test-*` in `afterEach`.)

- [ ] **Step 4: Run** `npm run verify` → green; `ls "${TMPDIR:-/tmp}" | grep -c '^cc-'` is unchanged by the run.

- [ ] **Step 5: Commit** `test: remove every temp dir the suites create (the Mac disk kept them)`

---

### Task 9: `npm run doctor` (row 28) and the Ollama binary location

**Files:**
- Create: `backend/server/doctor.ts`
- Modify: `package.json` (`doctor`, `ai:ollama`), `.env.example` (`OLLAMA_BIN`), `.claude/launch.json` (`ollama` entry)
- Test: `backend/server/doctor.test.ts` (new)

**Interfaces — Consumes:** `health()` (Task 1), `parseSpendCap` (`backend/modules/usage/spend.ts`), `MIN_FREE_BYTES` (Task 4). **Produces:**

```ts
export type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; hint?: string };
export type DoctorIo = {
  freeBytes(path: string): Promise<number>;
  stat(path: string): Promise<{ isDir: boolean; isSymlink: boolean; mtimeMs: number } | null>;
  readdir(path: string): Promise<string[]>;             // names only; [] when missing
  dirBytes(path: string): Promise<number>;              // `du -sk` × 1024
  which(bin: string): Promise<string | null>;
  run(cmd: string, args: string[]): Promise<string>;    // stdout; throws on a non-zero exit
  fetch: typeof fetch;
  transcriber: { health(): Promise<"ok" | "down"> };
  llm: { health(): Promise<{ status: "ok" | "down" | "model_missing"; model: string }> };
  now(): number;
};
export type DoctorPaths = { home: string; tmp: string; repo: string; dataDir: string; depsDir: string; tmpDir: string };
export async function runDoctor(env: NodeJS.ProcessEnv, io: DoctorIo, paths: DoctorPaths): Promise<Check[]>;
export function formatReport(checks: Check[]): string;  // "ok   name — detail" / "WARN name — detail (hint)" / "FAIL …"
```

Check names and rules (exact `name`s, used by the test): `temp volume` (fail < `MIN_FREE_BYTES`, warn < 10 GiB), `DATA_DIR` (fail when `stat` finds no directory; else its free bytes with the same thresholds), `WORK_DIR` (only when set), `repo volume` (warn < 10 GiB), `SabiDev mount` (`paths.home + "/SabiDev"` is a dir), `node_modules link` (a symlink into `paths.depsDir`), `stale deps` (entries of `depsDir` other than `main`, `.remotion` and the names in `git worktree list --porcelain`; warn with `rm -rf <path>` per entry and total bytes), `stale tmp` (entries of `tmpDir` with `mtimeMs < now − 86 400 000`; warn with `rm -rf` lines), `ffmpeg`, `uv`, `ollama binary` (`env.OLLAMA_BIN ?? "ollama"`: a path is `stat`ed, a bare name `which`ed), `remotion browser` (`<repo>/node_modules/.remotion/chrome-headless-shell` exists, else warn "the first render downloads 570 MB to the Mac disk"), `whisperX` (via `io.transcriber.health()`), `Ollama` (via `io.llm.health()`; `model_missing` → fail with hint `ollama pull <model>`), `Postgres` / `MinIO` / `Redis` (only when `DATABASE_URL` / `S3_ENDPOINT` / `REDIS_URL` is set; `run("psql"…)` is not available — use `pg` `Pool.query("SELECT 1")`, `fetch(<S3_ENDPOINT>/minio/health/live)`, `ioredis` `ping()` as `boot.ts` does), `PEXELS_KEY` (unset → warn `set PEXELS_KEY in the API's shell for stock B-roll`; set → `GET https://api.pexels.com/v1/search?query=sky&per_page=1` with header `authorization: <key>`, 5 s → `verified`, 401/403 → fail `rejected (401)`, else warn `could not verify`), `FAL_KEY` (`set` / `unset`, always ok), `SPEND_CAP_CENTS` (`parseSpendCap`; a throw → fail), `tagalog sample` (`<repo>/ai/evaluation/fixtures/tagalog-sample.wav` exists and `ffprobe -show_entries stream=sample_rate,channels` says `16000` / `1`; missing → warn with `ffmpeg -i rec.m4a -ac 1 -ar 16000 ai/evaluation/fixtures/tagalog-sample.wav`).

- [ ] **Step 1: Write the failing tests**

```ts
// backend/server/doctor.test.ts
import { MIN_FREE_BYTES } from "../shared/disk";
import { type Check, type DoctorIo, formatReport, runDoctor } from "./doctor";

const GiB = 1024 ** 3;
const paths = { home: "/h", tmp: "/h/Developer/.sabi-tmp", repo: "/h/SabiDev/repo", dataDir: "/ssd/data", depsDir: "/h/Developer/.sabi-deps", tmpDir: "/h/Developer/.sabi-tmp" };
const io = (over: Partial<DoctorIo> = {}): DoctorIo => ({
  freeBytes: async () => 20 * GiB,
  stat: async (p) => (p === "/h/SabiDev/repo/node_modules" ? { isDir: true, isSymlink: true, mtimeMs: 0 } : { isDir: true, isSymlink: false, mtimeMs: Date.now() }),
  readdir: async (p) => (p === paths.depsDir ? ["main", "objective-lamarr-f09862", "old-branch", ".remotion"] : p === paths.tmpDir ? ["bench-1", "fresh"] : []),
  dirBytes: async () => 600 * 1024 ** 2,
  which: async (bin) => (bin === "ollama" ? null : `/opt/homebrew/bin/${bin}`),
  run: async (cmd, args) => (cmd === "git" ? "worktree /h/SabiDev/repo\nbranch refs/heads/main\n\nworktree /h/SabiDev/repo/.claude/worktrees/objective-lamarr-f09862\nbranch refs/heads/x\n" : args.includes("sample_rate") ? "16000\n1\n" : "ffmpeg version 8.1.2"),
  fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch,
  transcriber: { health: async () => "ok" },
  llm: { health: async () => ({ status: "ok", model: "qwen2.5:3b" }) },
  now: () => Date.now(),
  ...over,
});
const by = (checks: Check[], name: string) => checks.find((c) => c.name === name)!;

it("a healthy machine with nothing set: ok everywhere except the keys and the WAV", async () => {
  const checks = await runDoctor({ OLLAMA_BIN: "/h/SabiDev/bin/ollama-dist/ollama" }, io({ readdir: async (p) => (p === paths.depsDir ? ["main", "objective-lamarr-f09862", ".remotion"] : []) }), paths);
  expect(checks.filter((c) => c.status === "fail")).toEqual([]);
  expect(by(checks, "PEXELS_KEY")).toMatchObject({ status: "warn", detail: "unset" });
  expect(by(checks, "FAL_KEY")).toMatchObject({ status: "ok", detail: "unset" });
  expect(by(checks, "ollama binary").status).toBe("ok"); // the path is stat'ed, not which'ed
  expect(checks.map((c) => c.name)).not.toContain("Postgres"); // DATABASE_URL unset
});

it("flags a full temp volume, stale deps and tmp entries, a missing model and a missing binary", async () => {
  const stale = (p: string) => (p === `${paths.tmpDir}/bench-1` ? { isDir: true, isSymlink: false, mtimeMs: Date.now() - 2 * 86_400_000 } : { isDir: true, isSymlink: false, mtimeMs: Date.now() });
  const checks = await runDoctor({}, io({
    freeBytes: async (p) => (p === paths.tmp ? MIN_FREE_BYTES - 1 : 20 * GiB), stat: stale,
    llm: { health: async () => ({ status: "model_missing", model: "qwen2.5:3b" }) },
  }), paths);
  expect(by(checks, "temp volume").status).toBe("fail");
  expect(by(checks, "stale deps")).toMatchObject({ status: "warn", hint: expect.stringContaining("rm -rf /h/Developer/.sabi-deps/old-branch") });
  expect(by(checks, "stale deps").hint).not.toContain("objective-lamarr");
  expect(by(checks, "stale tmp")).toMatchObject({ status: "warn", hint: expect.stringContaining("rm -rf /h/Developer/.sabi-tmp/bench-1") });
  expect(by(checks, "stale tmp").hint).not.toContain("fresh");
  expect(by(checks, "Ollama")).toMatchObject({ status: "fail", hint: expect.stringContaining("ollama pull qwen2.5:3b") });
  expect(by(checks, "ollama binary").status).toBe("fail");
});

it("verifies PEXELS_KEY with one search and never prints it", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ photos: [] }), { status: calls.length === 1 ? 200 : 401 });
  }) as typeof fetch;
  const ok = await runDoctor({ PEXELS_KEY: "abc123secret" }, io({ fetch: fetchFn }), paths);
  expect(by(ok, "PEXELS_KEY")).toMatchObject({ status: "ok", detail: "verified" });
  expect(calls).toEqual([{ url: "https://api.pexels.com/v1/search?query=sky&per_page=1", auth: "abc123secret" }]);
  const bad = await runDoctor({ PEXELS_KEY: "abc123secret" }, io({ fetch: fetchFn }), paths);
  expect(by(bad, "PEXELS_KEY")).toMatchObject({ status: "fail", detail: "rejected (401)" });
  expect(formatReport([...ok, ...bad])).not.toContain("abc123secret");
});

it("formatReport is one line per check and exits on fail", () => {
  const text = formatReport([{ name: "ffmpeg", status: "ok", detail: "8.1.2" }, { name: "whisperX", status: "fail", detail: "down", hint: "npm run ai:whisperx" }]);
  expect(text.split("\n")).toEqual(["ok   ffmpeg — 8.1.2", "FAIL whisperX — down (npm run ai:whisperx)"]);
});
```

- [ ] **Step 2: Run** `npx vitest run backend/server/doctor.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement.** `doctor.ts` holds `runDoctor`, `formatReport` and a `main` guarded by `import.meta.url === pathToFileURL(process.argv[1]).href` that builds the real `io` (`freeBytesOf` from `disk.ts`; `lstat`/`stat`; `readdir`; `du -sk`; `which` via `run("which", [bin])`; `execFile`; `globalThis.fetch`; `new WhisperXTranscriber(env.WHISPERX_URL ?? "http://localhost:8010")`; `new OllamaLlm(env.OLLAMA_URL ?? "http://localhost:11434", env.OLLAMA_MODEL ?? "qwen2.5:3b")`) and the paths (`homedir()`, `tmpdir()`, `process.cwd()`, `env.DATA_DIR ?? "/Volumes/PortableSSD/Bong/captions-clone-data"`, `${homedir()}/Developer/.sabi-deps`, `${homedir()}/Developer/.sabi-tmp`), prints `formatReport`, exits 1 when any check failed. `package.json`: `"doctor": "tsx backend/server/doctor.ts"`, `"ai:ollama": "OLLAMA_MODELS=${DATA_DIR:-/Volumes/PortableSSD/Bong/captions-clone-data}/ollama \"${OLLAMA_BIN:-ollama}\" serve"`. `.env.example` under the Ollama lines: `# OLLAMA_BIN: the Ollama binary when it is not on PATH (this Mac: the official tarball in ~/SabiDev/bin/ollama-dist, Mac disk untouched)` + `OLLAMA_BIN=`. `.claude/launch.json` `ollama` entry: `{ "name": "ollama", "runtimeExecutable": "sh", "runtimeArgs": ["-c", "OLLAMA_BIN=\"${OLLAMA_BIN:-$HOME/SabiDev/bin/ollama-dist/ollama}\" npm run ai:ollama"], "port": 11434 }`.

- [ ] **Step 4: Run** `npm run verify` → green; `npm run doctor` on this Mac prints a report (fails are expected until R2–R4) and exits 1.

- [ ] **Step 5: Commit** `feat(ops): npm run doctor — volumes, Sabi's Mac footprint, tools, services, keys (never printed), the Tagalog WAV; OLLAMA_BIN`

---

### Task 10: `npm run pipeline:sample` — the timed real run, plus the demo export timing

**Files:**
- Create: `tests/integration/pipeline.test.ts`
- Modify: `package.json` (`pipeline:sample`)

**Interfaces — Consumes:** `SabiApi` (`backend/mcp/client.ts`: `createProject`, `uploadFile`, `setSource`, `run`, `plan`, `broll`, `render`, `getJob`, `getProject`, `catalog`, `applyActions`, `downloadAsset`, `frame`). **Produces:** `"pipeline:sample": "RUN_PIPELINE=1 vitest run tests/integration/pipeline.test.ts"`. Env: `SABI_API_URL` (default `http://127.0.0.1:3001`), `SAMPLE_CLIP` (default `~/Developer/Reverse Engineer/test-clip-9x16.mp4`), `SAMPLE_LANGUAGE` (optional).

- [ ] **Step 1: Write the gated test** (it is the deliverable; it skips without `RUN_PIPELINE=1`)

```ts
// tests/integration/pipeline.test.ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { SabiApi, SabiHttpError } from "../../backend/mcp/client";
import { keptSegments } from "../../shared/editing/cuts";
import { enabledCuts } from "../../shared/editing/renderProps";
import type { JobState, Project } from "../../shared/types";

// The first real run, through the agent's own client (npm run pipeline:sample). Needs the API running (npm run dev:lite, real
// providers), whisperX and Ollama; Pexels only when the API has PEXELS_KEY. Never calls fal or generate.
const api = new SabiApi(process.env.SABI_API_URL ?? "http://127.0.0.1:3001");
const CLIP = (process.env.SAMPLE_CLIP ?? join(homedir(), "Developer/Reverse Engineer/test-clip-9x16.mp4"));
const SLOW = 1_800_000; // a cold sidecar downloads models on the first clip
const timings: [string, number][] = [];

// Polls the project's job until it finishes; records seconds per stage transition.
async function waitJob(id: string, label: string): Promise<JobState> {
  let last: string | undefined, at = Date.now();
  for (;;) {
    const job = await api.getJob(id);
    if (!job) throw new Error(`${label}: no job`);
    if (job.stage !== last) { if (last) timings.push([`${label}/${last}`, (Date.now() - at) / 1000]); last = job.stage; at = Date.now(); }
    if (job.state === "COMPLETE" || job.state === "FAILED") { if (last) timings.push([`${label}/${last}`, (Date.now() - at) / 1000]); return job; }
    await new Promise((r) => setTimeout(r, 500));
  }
}
const probe = (file: string, entries: string) =>
  execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "default=nw=1:nk=1", file]).toString().trim().split("\n").map(Number);

describe.skipIf(process.env.RUN_PIPELINE !== "1")("pipeline on a real clip", () => {
  let project: Project;
  afterAll(() => { console.log(["stage | seconds", ...timings.map(([s, t]) => `${s} | ${t.toFixed(1)}`), `total | ${timings.reduce((n, [, t]) => n + t, 0).toFixed(1)}`, "spent 0¢"].join("\n")); });

  it("uploads the clip", async () => {
    if (!existsSync(CLIP)) return console.log(`skipped: no clip at ${CLIP} (set SAMPLE_CLIP)`);
    project = await api.createProject("Real run");
    const asset = await api.uploadFile(CLIP, "video/mp4", project.id);
    project = await api.setSource(project.id, asset.id);
    expect(project.sourceAssetId).toBe(asset.id);
  }, SLOW);

  it("captions: real whisperX", async () => {
    if (!project) return;
    await api.run(project.id, process.env.SAMPLE_LANGUAGE ? { language: process.env.SAMPLE_LANGUAGE } : {});
    const job = await waitJob(project.id, "captions");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    expect(project.phrases.length).toBeGreaterThan(0);
    const words = project.phrases.flatMap((p) => p.words);
    words.forEach((w, i) => { if (i) expect(w.startMs).toBeGreaterThanOrEqual(words[i - 1].startMs); });
    console.log(`language ${project.language}, ${words.length} words, estimated ${project.transcript?.estimatedWords ?? 0}, warnings ${project.warnings.join(",") || "none"}`);
  }, SLOW);

  it("plan: real Ollama", async () => {
    if (!project) return;
    await api.plan(project.id, { languages: [], burnInLanguage: null });
    const job = await waitJob(project.id, "plan");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    expect(project.editPlan!.shots.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(project.editPlan!.cuts)).toBe(true);
    for (const p of project.phrases) expect(p.words.filter((w) => w.emphasis).length).toBeLessThanOrEqual(2);
  }, SLOW);

  it("stock B-roll when Pexels is available (never fal)", async () => {
    if (!project) return;
    const pexels = (await api.catalog()).models.find((m) => m.provider === "pexels" && m.media === "image")!;
    if (!pexels.available) return console.log("broll skipped: PEXELS_KEY unset on the API");
    const r = await api.applyActions(project.id, { baseVersion: project.updatedAt, actions: [{ type: "setMediaSource", mediaSource: "stock" }], render: false });
    expect(r.project.mediaSource).toBe("stock");
    await api.broll(project.id, { regenerate: false });
    const job = await waitJob(project.id, "broll");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    if (!project.overlays.length) console.log(`no overlays: ${project.warnings.filter((w) => w.startsWith("broll_not_found") || w === "no_broll_shots").join(",")}`);
    expect(project.creditsUsedCents).toBe(0);
  }, SLOW);

  it("render + frame", async () => {
    if (!project) return;
    await api.render(project.id, { scale: 1 });
    const job = await waitJob(project.id, "render");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
    try {
      const mp4 = join(dir, "out.mp4");
      await api.downloadAsset(project.outputs.mp4AssetId!, mp4);
      const [durationS] = probe(mp4, "format=duration");
      // The plan enables pause/filler cuts: the MP4 is the kept length (as backend/mcp/tools.ts outputMs computes it).
      const outputMs = keptSegments(project.sourceDurationMs!, enabledCuts(project)).reduce((ms, s) => ms + s.endMs - s.startMs, 0);
      expect(Math.abs(durationS * 1000 - outputMs)).toBeLessThanOrEqual(100);
      expect(statSync(mp4).size).toBeGreaterThan(100_000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const { data, problems } = await api.frame(project.id, 1000, 540);
    expect(data.length).toBeGreaterThan(1024);
    expect(problems).toEqual([]);
  }, SLOW);
});

describe.skipIf(process.env.RUN_PIPELINE !== "1")("demo export timing (MG sandbox)", () => {
  const exportDemo = async (scale: 1 | 2) => {
    const t0 = Date.now();
    await api.render("demo", { scale });
    const job = await waitJob("demo", `demo-${scale === 2 ? "4k" : "1080p"}`);
    expect(job.state, job.error).toBe("COMPLETE");
    const p = await api.getProject("demo");
    const dir = mkdtempSync(join(tmpdir(), "demo-"));
    try {
      const mp4 = join(dir, "demo.mp4");
      await api.downloadAsset(p.outputs.mp4AssetId!, mp4);
      expect(probe(mp4, "stream=width,height")).toEqual(scale === 2 ? [2160, 3840] : [1080, 1920]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    console.log(`demo export ${scale === 2 ? "4K" : "1080p"}: ${((Date.now() - t0) / 1000).toFixed(1)} s (pre-sandbox 1080p baseline 14 s, 2026-10-22)`);
  };
  it("renders the demo at 1080p and 4K", async () => {
    const demo = await api.getProject("demo").catch((e) => (e instanceof SabiHttpError && e.status === 404 ? null : Promise.reject(e)));
    if (!demo) return console.log("skipped: no demo project (dev:lite seeds it)");
    await exportDemo(1);
    await exportDemo(2);
  }, SLOW);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/integration/pipeline.test.ts` → both describes skipped (no `RUN_PIPELINE`). `tests/` is outside both tsconfigs, so vitest's esbuild pass is the compile check; `RUN_PIPELINE=1 npx vitest run tests/integration/pipeline.test.ts` with no API running must fail fast with `Sabi API not reachable`, not hang.

- [ ] **Step 3: Add** the npm script. Nothing else to implement.

- [ ] **Step 4: Run** `npm run verify` → green.

- [ ] **Step 5: Commit** `test(integration): pipeline:sample — the timed real run through the MCP client, Pexels only, plus the demo export at 1080p and 4K`

---

### Task 11: Docs before the run

**Files:**
- Modify: `PROJECT.md` ("Run / verify" step 0 = `npm run doctor`; a "First real run" numbered runbook; Decisions: disk floor, error codes, services hint, Ollama location; State: plan 7 "in progress"), `docs/superpowers/plans/README.md` (row 7 "(planned)" → "in progress"), `.claude/skills/sabi-editor/SKILL.md` (done in Task 6; re-read for the Whisper-code line)

- [ ] **Step 1:** PROJECT.md "Run / verify": first bullet `0. npm run doctor — …`; `ai:ollama` line mentions `OLLAMA_BIN=~/SabiDev/bin/ollama-dist/ollama` (official tarball, sha256 verified, signed by Ollama Inc; the Mac disk untouched); the first-run runbook = R1–R8 below, one line each, with "owner" marked on R4 and R7.
- [ ] **Step 2:** Decisions: `disk_low` 2 GiB floor on MP4 renders only; three codes per local provider + the Whisper enum; `/api/health.services` (1.5 s / 30 s, key presence); `wait_job` ends with `baseVersion`, `run_job` does not and why; B-roll keep rule.
- [ ] **Step 3:** `npm run verify` → green (PROJECT.md is prose). **Commit** `docs: PROJECT.md runbook for the first real run; plan 7 in progress`

---

## The real run (plan-level steps; the implementer executes, PROJECT.md State → "Real run (2026-10-31)")

Record for every step: what ran, minutes, sizes, the exact report or table, warnings. **Fix small, defer big** (design, Decisions): a config or one-line code fix lands in this branch (test-first, then `npm run verify`); anything larger goes under "Deferred to plan 8" and the plan still ships.

- [ ] **R1 Doctor, cold.** `npm run doctor` → paste the report into PROJECT.md. Expected: `whisperX` and `Ollama` fail, `tagalog sample` warn, `PEXELS_KEY` warn.
- [ ] **R2 whisperX.** `uv sync` into `ai/transcription/.venv` is already running — wait for it (`ls ai/transcription/.venv/bin/uvicorn`); then `npm run ai:whisperx` in its own tab (launch `whisperx`). The first clip downloads the `small` model into `$DATA_DIR/hf`. Check `curl -s localhost:8010/health` → `{"ok":true,"model":"small"}`. Record venv size (`du -sh ai/transcription/.venv`), minutes, and that `df -h /System/Volumes/Data` did not move.
- [ ] **R3 Ollama from the image.** Check the binary starts from the image: `~/SabiDev/bin/ollama-dist/ollama --version` must answer within 30 s (it hung once on first launch; retry once after `xattr -dr com.apple.quarantine ~/SabiDev/bin/ollama-dist`). If it still hangs: **fallback** `brew install ollama` (~200 MB on the Mac disk; approved under "fix small") and leave `OLLAMA_BIN` unset. Then `OLLAMA_BIN=~/SabiDev/bin/ollama-dist/ollama npm run ai:ollama` in its own tab (launch `ollama`), `"$OLLAMA_BIN" pull qwen2.5:3b` (1.9 GB → `$DATA_DIR/ollama`). Record the version, pull minutes, `ls $DATA_DIR/ollama`.
- [ ] **R4 PAUSE — owner starts the API.** Tell the owner: "In your own terminal tab, in this worktree: `PEXELS_KEY=… npm run dev:lite` (or plain `npm run dev:lite` for no Pexels) and say when `renderer warm in …` prints." The implementer never sees, asks for or types the key. Then `npm run doctor` (in the implementer's tab, without the key: `PEXELS_KEY` reads `unset` there — expected) → everything else green except `tagalog sample`. Paste.
- [ ] **R5 The run.** `npm run pipeline:sample` → paste the `stage | seconds` table and the `language …, N words, estimated …` line. If `plan` fails `llm_invalid_output` once, run it again (temperature 0; the retry prompt differs) and record both. If captions fail `transcriber_timeout` on the 21 s clip, the sidecar is CPU-bound: record the sidecar's log tail and defer.
- [ ] **R6 Demo export timing** is in R5's output (`demo export 1080p: … s`, `4K: … s`). Record both against the 14 s baseline; PROJECT.md plan 6 "Not yet done: demo export timing" → done. If 4K fails `disk_low`, that is the floor working: free space and rerun; record the peak (`df` before/after).
- [ ] **R7 Tagalog sample (owner).** Only if `ai/evaluation/fixtures/tagalog-sample.wav` exists: `npm run transcribe:sample` (the first `tl` run downloads the 1.26 GB aligner) → record; else PROJECT.md says "still skipped: WAV not recorded".
- [ ] **R8 Web check.** `npm run dev`; browser at 375 px and desktop: the harness project's captions, plan, B-roll overlays (if Pexels); stop the sidecar → Home shows `whisperX off` within 30 s and the Captions empty state (a new project) names it; start it again → the line disappears. Screenshot notes into PROJECT.md.
- [ ] **R9 Record.** PROJECT.md State: the two reports, the table, versions (`uv run --directory ai/transcription python -c "import whisperx; print(whisperx.__version__)"`, `"$OLLAMA_BIN" --version`), sizes, "Deferred to plan 8" list. Commit `docs: first real run recorded (whisperX, Ollama, Pexels if present), demo export timing`.

---

## Whole-branch review (one pass, at the end)

Dispatch one fresh reviewer over the whole branch diff against `main` with the design and rows 28–32. **Review Focus** — check hardest, in this order:
1. **No fal path:** `grep -rn "generate\b\|generator" tests/integration/pipeline.test.ts backend/server/doctor.ts` shows only the catalog read and `!!deps.generator`; the harness sets `setMediaSource stock` before `broll`; no new call site of `chargeGeneration`.
2. **No key leaks:** `doctor.ts` never interpolates `env.PEXELS_KEY` / `env.FAL_KEY` into a `Check`, a log or an error; the Pexels probe passes the key only as the `authorization` header; no test fixture carries a real-looking key; `git log -p` on the branch has no `PEXELS_KEY=`.
3. **Disk floor placement:** `assertDiskRoom` runs inside `renderOutputs`'s `try`, before `renderer.render`, after the transcript/plan were saved; `/frame`, uploads and `apply_actions` have no gate; `makeTestDeps.freeBytes` is `Infinity`; `index.ts`/`makeMemoryDeps` use `statfs`.
4. **Health memo:** one in-flight probe shared by concurrent requests (the memo stores the promise, not the value), 30 s by `deps.now()`, 1.5 s per probe, parallel; `stock`/`generator` never fetch; the schema is required and the web parses it.
5. **B-roll keep rule:** keep ignores `media`; `allowVideo` false whenever a video overlay exists and `regenerate` is off; the existing "refresh keeps / regenerate replaces" case still passes; "Video:" only for `media === "video"`.
6. **Error-code mapping end to end:** adapter → job error → `GET /job` → web `ERRORS` and MCP `JOB_ERRORS` each have all seven codes with the exact copy; `transcriber_rejected` reaches the web as the "pick another language" string; `RunInput` and `run_job` share one enum; `server.py` returns 400 only for `ValueError`.
7. **Test temp cleanup:** every `mkdtempSync` in the suites is tracked or removed in `afterAll`; `setup.ts` imports only `testDirs.ts`.
8. **Sidecar liveness:** `transcribe` is a plain `def` and `/health` has no await on the model; row 22 (one job at a time) keeps the threadpool to one transcription.

Rulings go in the PR description as in plans 4–6 (Critical/Important fixed with tests; Minors re-graded or listed as "Deferred review minors (plan 7)" in PROJECT.md).

## Finish

- [ ] `npm run verify` green; `npm run build` green; `npm run render:sample` green (22/22; the disk gate sits on the render path).
- [ ] **No DB migration** — `schema.sql` is untouched; say so in the PR.
- [ ] PROJECT.md (honey-memory): State → plan 7 merged/pending with the real-run numbers, "Deferred review minors (plan 7)", plan 6's "Not yet done" closed; "Next" → plan 8 (hardening, re-graded by the run), plan 9 (deploy + auth batch); `last Claude session` stamp.
- [ ] `docs/superpowers/plans/README.md` row 7: "(planned)" → ✅ with the one-line delivery and spec rows 28–32.
- [ ] PR to `main` from `claude/objective-lamarr-f09862`: title `Plan 7 — first real run: doctor, honest provider errors, disk floor, services hint, pipeline:sample (spec rows 28–32)`; body = goal, what changed, the real-run table, review rulings, "no DB migration", "no fal called". **No `Co-Authored-By` and no "Generated with" lines** (the commit-msg hook strips them from commits; write the PR body without them).
