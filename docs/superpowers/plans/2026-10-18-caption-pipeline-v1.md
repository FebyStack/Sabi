# Caption Pipeline v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user uploads a talking-head clip, runs the pipeline, watches staged progress, edits caption spelling, and downloads a burned-in MP4 plus SRT/VTT.

**Architecture:** Express API with injected deps (`createApp(deps)`), filesystem storage under `DATA_DIR`, an in-process job runner publishing SSE events per project, a whisperX Python sidecar for word-timestamped transcription, pure caption segmentation in `shared/`, and one Remotion composition (`shared/remotion/`) used both by the server renderer and the browser preview.

**Tech Stack:** Node 22 + Express 5 + zod 4 + pg; React 19 + Vite 7 + Tailwind 4 + TanStack Query; `remotion` + `@remotion/renderer` + `@remotion/bundler` + `@remotion/player`; `react-router` 7; whisperX via `uv` (Python 3.12); ffmpeg/ffprobe (local build without libass — never used for text).

**Spec:** `docs/spec.md` (Locked Spec §11) and `docs/blueprint.md` §10.3–10.4. Existing scaffold conventions: `PROJECT.md`.

## Global Constraints

- Platforms: desktop **and mobile web** — every control ≥ 44 px, single-column layout under 768 px (spec 11.1).
- Outputs: MP4 1080p (1080×1920 for `9:16`, 1920×1080 for `16:9`, 30 fps) with burned-in captions, plus `.srt` and `.vtt` (spec 11.4; 4K is a later toggle, keep width/height as parameters).
- Providers: whisperX self-hosted at `WHISPERX_URL` (default `http://localhost:8010`); **no Anthropic API anywhere**; no fal.ai/Pexels in this plan (spec 11.7).
- Storage: all media under `DATA_DIR` (default `/Volumes/PortableSSD/Bong/captions-clone-data`), never under the repo (PROJECT.md).
- Privacy: uploaded files are stored as-is; rendered outputs are fresh files (no source metadata); `last_access` updated on every project read so the plan-5 sweep can enforce 30 days (spec 11.2).
- Limits: upload ≤ 2 GB; mime ∈ {`video/mp4`, `video/quicktime`, `audio/mpeg`, `audio/wav`}; clip duration ≤ 10 min (captions parity with Captions web).
- Boundary rules: backend never imports `frontend/`; Remotion compositions live in `shared/remotion/` because both tiers consume them (frontend at build time, backend via `@remotion/bundler`).
- Tests colocated as `*.test.ts(x)`; `npm run verify` must stay green after every task; ExFAT: run `dot_clean -m .` if a `._*` file appears in a test run.

## Review Focus

1. Clip with no speech (silence/music): pipeline must finish `ready` with `phrases: []`, `outputs.srt` empty-but-valid, and `warnings: ["no_speech"]` — Task 6 test `pipeline marks no_speech`.
2. Landscape upload into a default `9:16` project: `/source` must set `aspectRatio` from probed dimensions (`16:9` when width > height) rather than cropping — Task 6 test `source sets aspect ratio from probe`.
3. Oversized or wrong-type upload: `uploads/start` returns 413 for `sizeBytes > 2 GiB` and 415 for an unsupported mime — Task 1 test `rejects oversized and wrong mime`.
4. Second `run` while a job is processing: 409 `{error:"busy"}`, no duplicate job — Task 6 test `run while busy returns 409`.
5. whisperX sidecar unreachable: job ends `FAILED` with `error:"transcriber_unavailable"`, project `status:"failed"`, SSE emits the failure — Task 6 test `transcriber failure marks project failed`.
6. A single word longer than `maxCharsPerLine`: segmentation places it on its own line and terminates — Task 4 test `long word gets its own line`.

---

### Task 1: Storage, media probing and asset uploads

**Files:**
- Create: `backend/shared/storage.ts`, `backend/shared/media.ts`, `backend/modules/assets/repository.ts`, `backend/modules/assets/routes.ts`, `backend/modules/assets/routes.test.ts`
- Modify: `shared/contract.ts`, `shared/types.ts`, `backend/shared/deps.ts`, `backend/shared/testing.ts`, `backend/app/app.ts`, `backend/server/index.ts`, `backend/server/index-lite.ts`, `database/schema/schema.sql`

**Interfaces:**
- Produces `Storage { write(key: string, data: Readable | Buffer): Promise<void>; read(key: string): Readable; stat(key: string): Promise<{ size: number } | null>; remove(key: string): Promise<void>; localPath(key: string): string }` with `FsStorage(root: string)`.
- Produces `Media { probe(path: string): Promise<MediaInfo>; extractAudio(input: string, outWav: string): Promise<void> }` with `MediaInfo = { durationMs: number; width?: number; height?: number }`, `FfmpegMedia()` (ffprobe `-show_entries format=duration:stream=width,height -of json`; ffmpeg `-vn -ac 1 -ar 16000 -c:a pcm_s16le`), `FakeMedia(info: MediaInfo)`.
- Produces `Asset = { id; projectId: string | null; kind: "video"|"audio"|"image"|"render"|"subtitle"; key; mimeType; sizeBytes; durationMs?; width?; height?; createdAt }` (zod `AssetSchema` in contract), `AssetRepository { get, create, listByProject }` with Memory + Pg impls.
- Produces routes: `POST /api/assets/uploads/start {fileName, mimeType, sizeBytes}` → `{uploadId}`; `PUT /api/assets/uploads/:uploadId` (raw body, streamed to `uploads/<uploadId>`) → 204; `POST /api/assets/uploads/:uploadId/done {projectId?}` → `Asset` (201); `GET /api/assets/:id/file` → bytes with `content-type`.
- `AppDeps` gains `storage: Storage; media: Media; assets: AssetRepository`. `makeTestDeps` uses `FsStorage(mkdtempSync(join(tmpdir(), "cc-")))` and `FakeMedia({ durationMs: 21000, width: 1080, height: 1920 })`.

- [ ] **Step 1: Write failing tests in `backend/modules/assets/routes.test.ts`**

```ts
it("uploads a video and probes it", async () => {
  const a = createApp(makeTestDeps());
  const start = await request(a).post("/api/assets/uploads/start").send({ fileName: "clip.mp4", mimeType: "video/mp4", sizeBytes: 5 });
  expect(start.status).toBe(200);
  const { uploadId } = start.body;
  expect((await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from("hello"))).status).toBe(204);
  const done = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
  expect(done.status).toBe(201);
  expect(done.body).toMatchObject({ kind: "video", mimeType: "video/mp4", sizeBytes: 5, durationMs: 21000, width: 1080, height: 1920 });
  const file = await request(a).get(`/api/assets/${done.body.id}/file`);
  expect(file.status).toBe(200); expect(file.text).toBe("hello");
});
it("rejects oversized and wrong mime", async () => {
  const a = createApp(makeTestDeps());
  expect((await request(a).post("/api/assets/uploads/start").send({ fileName: "x.mp4", mimeType: "video/mp4", sizeBytes: 2 * 1024 ** 3 + 1 })).status).toBe(413);
  expect((await request(a).post("/api/assets/uploads/start").send({ fileName: "x.gif", mimeType: "image/gif", sizeBytes: 10 })).status).toBe(415);
});
it("done on unknown upload is 404", async () => {
  expect((await request(createApp(makeTestDeps())).post("/api/assets/uploads/nope/done").send({})).status).toBe(404);
});
```

- [ ] **Step 2: Run `npx vitest run backend/modules/assets` — expect FAIL (module not found)**
- [ ] **Step 3: Implement `storage.ts`, `media.ts`, the assets repository and routes; add `assets` table to `schema.sql` (`id TEXT PK, project_id TEXT NULL, kind TEXT, key TEXT, mime_type TEXT, size_bytes BIGINT, duration_ms INT NULL, width INT NULL, height INT NULL, created_at TIMESTAMPTZ`); wire deps in `app.ts`, both server entries and `testing.ts`.** Upload state (`uploadId → {fileName, mimeType, sizeBytes}`) lives in a `Map` inside the router; `PUT` uses `express.raw({ type: () => true, limit: "2gb" })` and writes through `storage.write`. Keep the mime allow-list and the 2 GiB constant in `shared/contract.ts` as `UPLOAD_LIMITS`.
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(assets): filesystem storage, ffprobe media, upload routes"`

### Task 2: Job runner and per-project SSE

**Files:**
- Create: `backend/shared/events.ts`, `backend/shared/jobs.ts`, `backend/shared/jobs.test.ts`, `backend/modules/events/routes.ts`, `backend/modules/events/routes.test.ts`
- Modify: `shared/contract.ts`, `backend/shared/deps.ts`, `backend/shared/testing.ts`, `backend/app/app.ts`

**Interfaces:**
- Produces `EventBus { publish(projectId: string, event: ProjectEvent): void; subscribe(projectId: string, fn: (e: ProjectEvent) => void): () => void }` (`MemoryEventBus`).
- Produces `ProjectEvent = { type: "job"; job: JobState } | { type: "project"; status: ProjectStatus }` and `JobState = { id; projectId; kind: string; state: "QUEUED"|"PROCESSING"|"COMPLETE"|"FAILED"; progress: number; stage?: string; error?: string }` (zod in contract).
- Produces `JobRunner { enqueue(projectId: string, kind: string, run: (ctx: { report(progress: number, stage?: string): void }) => Promise<void>): JobState; active(projectId: string): JobState | null }` — `MemoryJobRunner(bus)` runs jobs one at a time per project (FIFO), publishes a `job` event on every state/progress change, catches errors into `FAILED` with `error = err.message`.
- Produces route `GET /api/projects/:id/events` — `text/event-stream`, replays the active job on connect, `event: <type>\ndata: <json>\n\n`, `: keepalive` every 15 s, unsubscribes on close.
- `AppDeps` gains `bus: EventBus; jobs: JobRunner`.

- [ ] **Step 1: Write failing tests**

```ts
// jobs.test.ts
it("runs jobs per project in order and reports progress", async () => {
  const bus = new MemoryEventBus(); const runner = new MemoryJobRunner(bus);
  const seen: JobState[] = []; bus.subscribe("p1", (e) => e.type === "job" && seen.push(e.job));
  const order: string[] = [];
  runner.enqueue("p1", "a", async ({ report }) => { report(50, "half"); order.push("a"); });
  runner.enqueue("p1", "b", async () => { order.push("b"); });
  await vi.waitFor(() => expect(order).toEqual(["a", "b"]));
  expect(seen.map((j) => [j.kind, j.state, j.progress])).toContainEqual(["a", "PROCESSING", 50]);
  expect(seen.at(-1)).toMatchObject({ kind: "b", state: "COMPLETE", progress: 100 });
});
it("marks a throwing job FAILED with its message", async () => { /* enqueue throws new Error("boom") → last event FAILED, error "boom", active(p1) === null */ });
// routes.test.ts — listen on port 0, fetch the stream, read until the first "event: job" frame
it("streams the active job then live events", async () => { /* enqueue a job that awaits a deferred; connect; expect first frame to contain "\"state\":\"PROCESSING\""; resolve; expect a COMPLETE frame */ });
```

- [ ] **Step 2: Run `npx vitest run backend/shared/jobs backend/modules/events` — expect FAIL**
- [ ] **Step 3: Implement `events.ts`, `jobs.ts`, the SSE route; register in `app.ts`; add `bus`/`jobs` to `makeTestDeps`/`makeMemoryDeps` and both server entries.**
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(jobs): in-process job runner with per-project SSE"`

### Task 3: whisperX sidecar and Transcriber

**Files:**
- Create: `ai/transcription/pyproject.toml`, `ai/transcription/server.py`, `ai/transcription/README.md`, `backend/shared/transcriber.ts`, `backend/shared/transcriber.test.ts`, `backend/shared/fixtures/transcript-sample.json`
- Modify: `shared/types.ts`, `backend/shared/deps.ts`, `backend/shared/testing.ts`, `backend/server/index.ts`, `backend/server/index-lite.ts`, `.claude/launch.json`, `package.json` (script `ai:whisperx`)

**Interfaces:**
- Sidecar: `POST /transcribe` multipart `file` (16 kHz mono WAV) + optional form `language` → `200 {"language":"en","words":[{"text":"Here","start":0.04,"end":0.18,"score":0.98}, …]}`; `GET /health` → `{"ok":true,"model":"small"}`. Env: `WHISPERX_MODEL` (default `small`), `WHISPERX_DEVICE` (default `cpu`), `WHISPERX_COMPUTE` (default `int8`). Uses `whisperx.load_model`, `load_align_model`, `align`; words without timestamps are dropped. Run: `uv run --project ai/transcription uvicorn server:app --host 127.0.0.1 --port 8010`.
- Produces `Transcript = { language: string; words: Word[] }` (`Word` exists in `shared/types.ts`: `{ id, text, startMs, endMs, confidence? }`; ids are `w-<index>`).
- Produces `Transcriber { transcribe(wavPath: string, opts?: { language?: string }): Promise<Transcript> }`; `WhisperXTranscriber(baseUrl: string)` (multipart `fetch`, seconds → ms rounding to integers, throws `Error("transcriber_unavailable")` on network error or non-2xx); `FakeTranscriber(transcript: Transcript)`.
- `AppDeps` gains `transcriber: Transcriber`; `makeTestDeps` uses `FakeTranscriber` loaded from `fixtures/transcript-sample.json` (the 20 s "morning routines" clip, 58 words).

- [ ] **Step 1: Write failing tests in `transcriber.test.ts`** — spin up `http.createServer` on port 0 returning the fixture in sidecar format (seconds); assert `words[0]` equals `{ id: "w-0", text: "Here", startMs: 40, endMs: 180, confidence: 0.98 }` and `language === "en"`; a server replying 500 → rejects with `transcriber_unavailable`; a closed port → same error.
- [ ] **Step 2: Run `npx vitest run backend/shared/transcriber` — expect FAIL**
- [ ] **Step 3: Implement `transcriber.ts`; write `server.py` + `pyproject.toml` (`whisperx`, `fastapi`, `uvicorn`, `python-multipart`; `requires-python = ">=3.11,<3.13"`); add `"ai:whisperx": "uv run --project ai/transcription uvicorn server:app --host 127.0.0.1 --port 8010"` and a `whisperx` entry (port 8010) to `.claude/launch.json`; wire deps.**
- [ ] **Step 4: Run `npm run verify` — expect PASS. Manual check once: `npm run ai:whisperx` in one tab, then `curl -F file=@sample.wav localhost:8010/transcribe` returns words (document the first-run model download in the README).**
- [ ] **Step 5: Commit** `git commit -am "feat(transcription): whisperX sidecar and Transcriber port"`

### Task 4: Caption segmentation, templates and subtitle files

**Files:**
- Create: `shared/captions/segment.ts`, `shared/captions/segment.test.ts`, `shared/captions/templates.ts`, `shared/captions/subtitles.ts`, `shared/captions/subtitles.test.ts`
- Modify: `shared/types.ts`, `shared/contract.ts`

**Interfaces:**
- `Phrase = { id: string; startMs: number; endMs: number; words: Word[]; lineBreaksAfter: number[] }` (indexes of words that end a line; replaces the scaffold's `Phrase` in `shared/types.ts`).
- `CaptionLayout = { maxCharsPerLine: number; maxWordsPerLine: number; maxLines: number; pauseSplitMs: number }`.
- `segmentCaptions(words: Word[], layout: CaptionLayout): Phrase[]` — pure. Rules, in priority: start a new phrase when the gap to the previous word ≥ `pauseSplitMs` or the previous word ends with `.`, `?`, `!`; within a phrase start a new line when adding the word would exceed `maxCharsPerLine` (characters incl. spaces) or `maxWordsPerLine`; start a new phrase when a new line would exceed `maxLines`; a word longer than `maxCharsPerLine` is placed alone on its own line. Phrase ids `ph-<n>`, `startMs/endMs` from first/last word.
- `CaptionTemplate = { id; name; font: { family: string; weight: number; sizePx: number }; colors: { text: string; activeWord: string; background?: string }; position: { y: number }  /* 0..1 from top, default 0.78 */; layout: CaptionLayout; animation: "karaoke" | "none" }`; `CAPTION_TEMPLATES: CaptionTemplate[]` with presets `clean` (Inter 700 64px, white, activeWord `#FFD60A`, layout 24/5/2/700ms), `bold` (Inter 900 80px, uppercase via `textTransform` field: add `uppercase: boolean` to the type), `karaoke` (`animation: "karaoke"`, background `rgba(0,0,0,.55)`); `getCaptionTemplate(id): CaptionTemplate` throws on unknown id. `CaptionTemplateSchema` + `CAPTION_TEMPLATE_IDS` enum in contract.
- `toSrt(phrases: Phrase[]): string`, `toVtt(phrases: Phrase[]): string` — lines joined with `\n` inside a cue per `lineBreaksAfter`; SRT time `HH:MM:SS,mmm`, VTT `HH:MM:SS.mmm` with `WEBVTT\n\n` header; empty input → `""` for SRT, `"WEBVTT\n"` for VTT.

- [ ] **Step 1: Write failing tests** — `segment.test.ts`: fixture of 12 words; `splits on sentence punctuation`, `splits on pause ≥ pauseSplitMs`, `breaks lines at maxCharsPerLine`, `respects maxLines`, `long word gets its own line` (a 40-char word with `maxCharsPerLine: 24`), `empty input → []`. `subtitles.test.ts`: two phrases → exact SRT string `"1\n00:00:00,040 --> 00:00:04,220\nHere is the thing\nabout morning routines.\n\n2\n…"`, VTT header and `.` separator, empty cases.
- [ ] **Step 2: Run `npx vitest run shared/captions` — expect FAIL**
- [ ] **Step 3: Implement `segment.ts`, `templates.ts`, `subtitles.ts`; update `shared/types.ts`/`contract.ts`.**
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(captions): segmentation, templates, SRT/VTT writers"`

### Task 5: Remotion composition and server renderer

**Files:**
- Create: `shared/remotion/index.ts`, `shared/remotion/Root.tsx`, `shared/remotion/CaptionVideo.tsx`, `shared/remotion/activeWord.ts`, `shared/remotion/activeWord.test.ts`, `backend/shared/renderer.ts`, `tests/integration/render.test.ts`
- Modify: `package.json` (deps `remotion`, `@remotion/renderer`, `@remotion/bundler`, `@remotion/player`, `@remotion/cli`; script `render:sample`), `backend/shared/deps.ts`, `backend/shared/testing.ts`, `backend/server/index.ts`, `backend/server/index-lite.ts`, `vite.config.ts` (nothing new unless `optimizeDeps` needs `remotion`), `.gitignore` (`.remotion-bundle/`)

**Interfaces:**
- `CaptionVideoProps = { videoSrc: string; phrases: Phrase[]; template: CaptionTemplate; width: number; height: number }`; composition id `"CaptionVideo"`, `fps: 30`, `durationInFrames` computed by the caller. The component renders `<OffthreadVideo src={videoSrc}>` (server) / `<Video>` (player — pick by `typeof window`), finds the phrase active at `frame/fps*1000`, draws its lines centred at `height * template.position.y`, colours the active word with `template.colors.activeWord` when `animation === "karaoke"`.
- `activeWordIndex(phrase: Phrase, timeMs: number): number` (−1 before the first word; last word index after the phrase ends); `phraseAt(phrases: Phrase[], timeMs: number): Phrase | null` — pure, in `activeWord.ts`.
- `Renderer { render(req: RenderRequest): Promise<void> }` with `RenderRequest = { compositionId: "CaptionVideo"; inputProps: CaptionVideoProps; durationMs: number; outPath: string }`; `RemotionRenderer({ entry: "shared/remotion/index.ts", bundleDir: ".remotion-bundle" })` bundles once (cached), `selectComposition` + `renderMedia({ codec: "h264", crf: 18 })`; `FakeRenderer()` writes `"fake-mp4"` to `outPath`.
- `AppDeps` gains `renderer: Renderer`.

- [ ] **Step 1: Write failing tests** — `activeWord.test.ts`: `phraseAt` returns the phrase containing 4100 ms and `null` at 100 000 ms; `activeWordIndex` for the sample phrase at 150 ms → 0, at 5 ms → −1, after end → last index. `tests/integration/render.test.ts` (skipped unless `process.env.RUN_RENDER === "1"`): renders the fixture phrases over a 2 s generated colour clip (`ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=2`) and asserts the output file > 10 KB.
- [ ] **Step 2: Run `npx vitest run shared/remotion` — expect FAIL**
- [ ] **Step 3: `npm i remotion @remotion/renderer @remotion/bundler @remotion/player @remotion/cli`; implement the composition, `activeWord.ts`, `renderer.ts`; add `"render:sample": "RUN_RENDER=1 vitest run tests/integration/render.test.ts"`; wire deps (`RemotionRenderer` in both server entries, `FakeRenderer` in `makeTestDeps`).**
- [ ] **Step 4: Run `npm run verify` — expect PASS; run `npm run render:sample` once — expect PASS and an MP4 with visible captions (open it).**
- [ ] **Step 5: Commit** `git commit -am "feat(render): Remotion CaptionVideo composition and server renderer"`

### Task 6: Pipeline orchestration and project API

**Files:**
- Create: `backend/modules/pipeline/pipeline.ts`, `backend/modules/pipeline/routes.ts`, `backend/modules/pipeline/pipeline.test.ts`
- Modify: `shared/contract.ts`, `shared/types.ts`, `backend/modules/projects/repository.ts`, `backend/modules/projects/routes.ts`, `backend/app/app.ts`, `database/schema/schema.sql`

**Interfaces:**
- `Project` gains `sourceAssetId: string | null; language: string | null; captionTemplateId: string ("clean" default); transcript: Transcript | null; phrases: Phrase[]; outputs: { mp4AssetId?: string; srtAssetId?: string; vttAssetId?: string }; warnings: string[]`; `ProjectRepository` gains `update(id, patch: Partial<Project>): Promise<Project>`; Pg columns `source_asset_id, language, caption_template_id, transcript JSONB, phrases JSONB, outputs JSONB, warnings JSONB` added via `ALTER TABLE projects ADD COLUMN IF NOT EXISTS …` lines in `schema.sql`. Every `GET /api/projects/:id` sets `last_access = now()`.
- Routes: `POST /api/projects/:id/source {assetId}` → project with `sourceAssetId`, `aspectRatio` from the asset (`16:9` if `width > height`, else `9:16`), status `draft`; `POST /api/projects/:id/run {language?}` → `202 {jobId}` or `409 {error:"busy"}` or `400 {error:"no_source"}`; `PUT /api/projects/:id/phrases {phrases}` → re-render job (skips transcription), `202`; `PUT /api/projects/:id/template {captionTemplateId}` → re-render job; `GET /api/projects/:id` → full project.
- `runCaptionPipeline(deps, projectId, opts: { language?: string; skipTranscribe: boolean })` enqueues one job `kind: "captions"` with stages and progress: `extract-audio` 10 → `transcribe` 40 → `segment` 60 → `render` 95 → `subtitles` 100. Status transitions: `transcribing` → `rendering` → `ready`; any throw → `failed` with `warnings` untouched and job `error`. Empty transcript → `phrases: []`, `warnings: ["no_speech"]`, still renders and ends `ready`. Output dimensions: `9:16 → 1080×1920`, `16:9 → 1920×1080`. Output assets: `kind: "render"` (`renders/<projectId>/<jobId>.mp4`), two `kind: "subtitle"` assets.

- [ ] **Step 1: Write failing tests in `pipeline.test.ts`** (supertest + `makeTestDeps`, await `vi.waitFor` on `GET /api/projects/:id` status): `runs upload → ready with three outputs` (phrases non-empty, `outputs` has all three ids, `GET /api/assets/:srt/file` text starts with `"1\n00:00:00,040"`), `source sets aspect ratio from probe` (FakeMedia 1920×1080 → `16:9`), `run while busy returns 409`, `run without source returns 400`, `transcriber failure marks project failed` (`FakeTranscriber` that throws `transcriber_unavailable`), `pipeline marks no_speech` (`FakeTranscriber({language:"en", words: []})`), `phrase edit re-renders without transcribing` (counter on the fake transcriber stays 1).
- [ ] **Step 2: Run `npx vitest run backend/modules/pipeline` — expect FAIL**
- [ ] **Step 3: Implement the pipeline module, project repository `update` (Memory + Pg), routes, contract changes and schema columns; register the router in `app.ts`.**
- [ ] **Step 4: Run `npm run verify` — expect PASS. Then the real path once: `npm run ai:whisperx`, `npm run dev:lite`, upload `~/Developer/Reverse Engineer/test-clip-9x16.mp4` with curl, `POST /run`, watch `curl -N localhost:3001/api/projects/<id>/events` reach `ready`, open the MP4.**
- [ ] **Step 5: Commit** `git commit -am "feat(pipeline): upload→transcribe→captions→render orchestration and project API"`

### Task 7: Project page (mobile-first)

**Files:**
- Create: `frontend/src/routes/router.tsx`, `frontend/src/features/projects/components/ProjectPage.tsx`, `frontend/src/features/projects/components/UploadDropzone.tsx`, `frontend/src/features/projects/components/StageProgress.tsx`, `frontend/src/features/projects/components/PhraseEditor.tsx`, `frontend/src/features/projects/components/CaptionPreview.tsx`, `frontend/src/features/projects/hooks/useProjectEvents.ts`, `frontend/src/features/projects/hooks/projectEvents.ts`, `frontend/src/features/projects/hooks/projectEvents.test.ts`, `frontend/src/features/projects/api/projects.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/services/http.ts`, `frontend/src/features/projects/components/ProjectList.tsx` (link rows to `/p/:id`), `package.json` (`react-router`)

**Interfaces:**
- Routes `/` → `ProjectList`, `/p/:id` → `ProjectPage` (`react-router` `createBrowserRouter`).
- `api/projects.ts`: `uploadFile(file: File, onProgress: (pct: number) => void): Promise<Asset>` (start → `XMLHttpRequest` PUT for progress → done), `setSource(id, assetId)`, `runProject(id, language?)`, `updatePhrases(id, phrases)`, `updateTemplate(id, templateId)`, `getProject(id)`, `assetFileUrl(assetId)`.
- `projectEvents.ts`: pure reducer `reduceProjectEvents(state: EventsState, e: ProjectEvent): EventsState` with `EventsState = { status: ProjectStatus | null; stage: string | null; progress: number; error: string | null }`; `useProjectEvents(id)` wraps `EventSource(api.projectEvents(id))` and invalidates the `["project", id]` query on `COMPLETE`/`FAILED`.
- `StageProgress` shows the five stages (`extract-audio, transcribe, segment, render, subtitles`) as labelled steps with the current one highlighted and `%`; `UploadDropzone` accepts the mime allow-list, shows upload `%`; `PhraseEditor` lists phrases as editable `<textarea>` rows (one per phrase, words joined by spaces; on blur re-splits on whitespace keeping original timings proportionally — the server owns timings, client only edits text) with an **Apply edits** button → `updatePhrases`; `CaptionPreview` uses `@remotion/player` `<Player component={CaptionVideo} …>` sized to the column width, `controls`; download links for MP4/SRT/VTT appear when `status === "ready"`.
- Layout: single column, `max-w-md mx-auto` below `md`, two columns (preview | editor) from `md:`; all buttons `min-h-11`.

- [ ] **Step 1: Write failing test `projectEvents.test.ts`** — reducer: a `job` event `{state:"PROCESSING", stage:"transcribe", progress:40}` → `{stage:"transcribe", progress:40}`; `FAILED` with `error:"boom"` → `error:"boom"`; a `project` event sets `status`.
- [ ] **Step 2: Run `npx vitest run frontend/src/features/projects` — expect FAIL**
- [ ] **Step 3: `npm i react-router`; implement the router, API module, hooks and components; `App.tsx` renders `<RouterProvider>`.**
- [ ] **Step 4: Run `npm run verify` and `npm run build` — expect PASS. Manual check with `npm run dev` + `npm run dev:lite` + `npm run ai:whisperx` in the browser pane at 375 px and 1280 px: upload → run → progress → edit a phrase → Apply → new MP4 → download all three files.**
- [ ] **Step 5: Commit** `git commit -am "feat(web): project page with upload, progress, preview, phrase editing, downloads"`

### Task 8: Docs and run configs

**Files:**
- Modify: `PROJECT.md` (State section, run recipe with the three processes), `.env.example` (no change unless new vars), `.claude/launch.json` (ensure `dev`, `api-lite`, `api`, `whisperx` entries), `docs/superpowers/plans/README.md` (mark plan 1 done)

- [ ] **Step 1: Update `PROJECT.md` State to "plan 1 complete" with the exact three-process run recipe and the known limits (whisperX CPU int8 speed on the Mac, Remotion first-run Chromium download size).**
- [ ] **Step 2: Run `npm run verify` — expect PASS**
- [ ] **Step 3: Commit** `git commit -am "docs: plan 1 complete, run recipe"`

---

## Self-review notes

- Spec coverage for this plan's slice: 11.1 (mobile layout, Task 7), 11.2 partial (`last_access`, fresh render files; sweep and consent banner deferred to plans 4–5), 11.3 (solo, `org_id` nullable kept), 11.4 (MP4 + SRT/VTT, 4K deferred as a width/height parameter), 11.5 partial (staged progress + empty states; demo project in plan 4), 11.6 (standalone, filesystem storage under `DATA_DIR` — S3 adapter in plan 5), 11.7 (whisperX local; Ollama/fal/Pexels in plans 2–3), 11.8 (a) English captions with karaoke — emphasis/emoji in plan 2; (b)–(d) later plans, 11.9 n/a.
- Type consistency: `Phrase` is redefined in Task 4 and consumed unchanged by Tasks 5–7; `AppDeps` grows in Tasks 1, 2, 3, 5 and `makeTestDeps` is updated in each; `ProjectEvent`/`JobState` defined in Task 2 and reused by Task 7's reducer.
- Review Focus items 1–6 each have a named test in Tasks 1, 4 and 6.
