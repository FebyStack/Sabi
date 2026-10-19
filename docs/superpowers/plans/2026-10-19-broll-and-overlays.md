# B-roll & Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an edit plan exists, "Add B-roll" turns every `B-Roll` / `Talking Head & B-Roll` shot into a beat, fetches a matching image or clip (Pexels stock, or fal.ai generation when the project's media source is `generate`), lays it on the timeline as an overlay the user can toggle, re-time, replace or regenerate, and renders it into the MP4 — preview = export.

**Architecture:** Beats are derived from plan-2 shots by a pure function; the LLM (existing `Llm` port) only labels each beat with a search query and an image prompt. Two new injected ports — `StockSearch` (Pexels) and `MediaGenerator` (fal.ai) — return remote URLs that an `importRemote` helper copies into `Storage` as ordinary assets, so renders never fetch third-party hosts. Overlays live on the project in source time; `captionVideoProps()` (plan 2) maps them through enabled cuts for both the browser `Player` and the server render; the composition draws them as a layer between the base video and the captions, caption-aware (`top` placement never covers the caption band).

**Tech Stack:** existing (Express 5, zod 4, Remotion 4.0.536 `<Sequence>` / `<Img>` / `<OffthreadVideo>` / `interpolate`, React 19, TanStack Query, Tailwind 4) + Pexels REST API (`https://api.pexels.com/v1/search`, `/videos/search`, header `Authorization: <key>`) + fal.ai queue REST (`https://queue.fal.run/<model>`, header `Authorization: Key <key>`). No new npm dependencies.

**Spec:** `docs/spec.md` §11.7 (fal.ai default, per-project `mediaSource: "stock"` → Pexels only), §11.8 (d: generated image **and** video B-roll), §11.1 (mobile), §11.2 (no third-party session replay; downloaded media is stored under `DATA_DIR`); `docs/blueprint.md` §10.3 step 5 ("stock-first B-roll keeps per-video cost near zero; generation gated"), §10.13. Plan-2 interfaces this extends: `shared/contract.ts` (`ShotSchema`, `EditPlanSchema`, `ProjectSchema`), `shared/editing/renderProps.ts` (`captionVideoProps`, `subtitleTracks`, `enabledCuts`), `shared/editing/cuts.ts` (`mapTime`, `keptSegments`), `shared/remotion/CaptionVideo.tsx`, `backend/modules/pipeline/pipeline.ts` (`renderOutputs`, `startCaptionJob`), `backend/modules/editplan/routes.ts` (`startPlanJob` pattern), `backend/shared/llm.ts` (`askJson`, `FakeLlm`), `backend/shared/testing.ts` (`makeTestDeps`, `fakeLlmResponder`), `backend/shared/apiTestHelpers.ts` (`readyProject`, `untilStatus`). Conventions: `PROJECT.md`.

## Global Constraints

- **No Anthropic API.** The only LLM is the plan-2 `Llm` port (Ollama). Providers: `PEXELS_KEY` (free tier, 200 req/h) and `FAL_KEY`; both optional at boot — a project whose media source needs a missing key fails its B-roll job with `stock_unavailable` / `generator_unavailable` and keeps its previous outputs.
- **Media source rule:** `project.mediaSource === "stock"` → Pexels only, never fal. `"generate"` → fal.ai for images (`fal-ai/flux/schnell`, ~$0.003/image) and **at most one video beat per project** (`fal-ai/kling-video/v1.6/standard/image-to-video`, 5 s, ~$0.25) — every other beat is an image; Pexels is the fallback when fal fails for a beat (never the other way round). Both model ids are constants in one place (`backend/shared/generator.ts`) so they are one edit to change.
- **Beat rules (pure, `shared/editing/beats.ts`):** one beat per shot of kind `B-Roll` or `Talking Head & B-Roll`; beat starts `300` ms after the shot start (never before `0`), lasts `min(shotLength − 300, 5000)` ms and is dropped if that is `< 1500` ms; `B-Roll` shots → `placement: "full"`, `Talking Head & B-Roll` → `placement: "top"`; `media` = `"image"` unless the LLM asked for `"video"` **and** the project allows it (rule above); beats never overlap (shots are contiguous, so this holds by construction — assert it).
- **Caption-aware placement:** `top` overlays occupy the band `[6 %, 55 %]` of the frame height with `16 px`-radius corners and `cover` fit; captions keep `template.position.y` (≥ 0.78). `full` overlays cover the frame; captions draw on top. Overlays never change caption layout.
- **Transitions:** `fade` = 10 frames in/out via `interpolate`; images get a Ken Burns zoom `1.0 → 1.08` over the overlay; videos play from their start, muted, looped if shorter than the overlay.
- **Attribution:** every stock overlay stores `attribution: { author, url }` (Pexels terms) and the panel shows "Photo: <author> / Pexels" linking to `url`. Generated overlays store `generationInfo { provider: "fal", model, prompt, costCents }`; the project's `creditsUsedCents` sums them (the ledger spec §11.9 wants; no billing).
- **Remote media is untrusted:** `importRemote` only follows `https:`, caps bodies at `50 MiB`, checks `content-type` ∈ {`image/jpeg`, `image/png`, `image/webp`, `video/mp4`}, probes with the existing `Media.probe` (ffprobe whitelist from plan 1) and rejects anything that fails; stock video results longer than `30 s` or wider than `1920` px are skipped in favour of the next result.
- Durations, cuts, rendering: as plan 2 — source-time storage, `mapTime` for the output timeline, one `captionVideoProps()` for preview and export.
- Single wire contract in `shared/contract.ts`; `shared/types.ts` only re-exports. `database/schema/schema.sql` changes are `ADD COLUMN IF NOT EXISTS` (unapplied until `make db && npm run dev:server`; Docker is not running — say so in PROJECT.md). The Pg `COL` map must gain every new project field (it is typed `Record<keyof Project, …>`, so typecheck enforces it).
- Mobile-first: controls ≥ 44 px, one column under 768 px. TDD, colocated tests, `npm run verify` green after every task; backend imports relative; no co-author lines in commits (`.githooks/commit-msg` strips them).

## Review Focus

1. **Plan without any B-roll shot** (planner labelled everything `Talking Head`/`Hook`): the job completes with `overlays: []`, `warnings` gains `"no_broll_shots"`, outputs unchanged, UI explains it. → Task 5 test `no b-roll shots completes with a warning`.
2. **Stock search returns nothing for the LLM's query** (or the key is rate-limited mid-job): retry with the beat's `intent` words, then skip the beat with `warnings: ["broll_not_found:<beatId>"]`; the job still completes with the other beats. → Task 5 test `empty stock result skips the beat`.
3. **A beat that falls inside an enabled cut** (user cut a pause the beat overlapped): the overlay is clipped to the kept part, or dropped when nothing is left, in the output timeline — and reappears when the cut is un-ticked. → Task 4 test `overlays follow enabled cuts`.
4. **Landscape stock photo in a 9:16 project** (or portrait in 16:9): queries use `orientation` matching the project, and the layer uses `cover` so no letterboxing appears either way. → Task 3 test `pexels query carries orientation`; Task 4 test `overlay layer covers the band`.
5. **fal.ai failure mid-project in generate mode** (quota, timeout, invalid key): that beat falls back to Pexels; if Pexels is also unavailable the beat is skipped with a warning; the job never leaves the project in `generating`. → Task 5 test `generation failure falls back to stock`.
6. **Replacing an overlay with an uploaded file of the wrong kind** (audio) or re-timing it outside its shot: `400 bad_asset` / `400 out_of_shot`; nothing changes. → Task 5 test `replace rejects audio and bad ranges`.

---

### Task 1: Contract, persistence and the media-source switch

**Files:**
- Modify: `shared/contract.ts`, `shared/types.ts`, `backend/modules/projects/routes.ts`, `backend/modules/projects/repository.ts`, `backend/modules/projects/repository.test.ts`, `backend/app/app.test.ts`, `database/schema/schema.sql`

**Interfaces:**
- Contract additions:
  ```ts
  export const OverlayPlacement = z.enum(["full", "top"]);
  export const OverlayMedia = z.enum(["image", "video"]);
  export const OverlaySource = z.enum(["stock", "generated", "uploaded"]);
  export const AttributionSchema = z.object({ author: z.string(), url: z.string().url() });
  export const GenerationInfoSchema = z.object({ provider: z.literal("fal"), model: z.string(), prompt: z.string(), costCents: z.number().int().nonnegative() });
  export const OverlaySchema = z.object({
    id: z.string(), shotId: z.string(), assetId: z.string(), media: OverlayMedia, source: OverlaySource,
    startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), placement: OverlayPlacement,
    transition: z.enum(["fade", "none"]).default("fade"), enabled: z.boolean().default(true),
    query: z.string().max(200), prompt: z.string().max(600), intent: z.string().max(200),
    attribution: AttributionSchema.optional(), generationInfo: GenerationInfoSchema.optional(),
  }).refine((o) => o.endMs > o.startMs, { message: "bad_range", path: ["endMs"] });
  ```
  `ProjectSchema` gains `overlays: z.array(OverlaySchema).default([])` and `creditsUsedCents: z.number().int().nonnegative().default(0)`.
- Inputs: `UpdateProjectInput = z.object({ mediaSource: MediaSource })`; `BrollInput = z.object({ regenerate: z.boolean().default(false) })`; `UpdateOverlaysInput = z.object({ overlays: z.array(z.object({ id, enabled?: boolean, startMs?: int, endMs?: int, placement?: OverlayPlacement, transition?: enum })).min(1) })`; `ReplaceOverlayInput = z.object({ assetId: z.string().min(1) })`; `RegenerateOverlayInput = z.object({ query: z.string().max(200).optional(), prompt: z.string().max(600).optional() })`.
- Routes added to `api`: `projectUpdate: (id) => /api/projects/${id}` (PATCH), `projectBroll: (id) => /api/projects/${id}/broll` (POST, PATCH), `projectOverlay: (id, overlayId) => /api/projects/${id}/broll/${overlayId}` (DELETE), `projectOverlayReplace: (id, overlayId) => …/replace` (POST), `projectOverlayRegenerate: (id, overlayId) => …/regenerate` (POST).
- `PATCH /api/projects/:id {mediaSource}` → updated project (200); `400 invalid_input`; `409 busy` while a job runs.
- Persistence: columns `overlays JSONB NOT NULL DEFAULT '[]'`, `credits_used_cents INTEGER NOT NULL DEFAULT 0`; `COL` + `JSON_COLS` updated; `MemoryProjectRepository` unchanged (whole-object).
- `backend/modules/projects/routes.ts` `POST /api/projects` initialises `overlays: [], creditsUsedCents: 0`.

- [ ] **Step 1: Write failing tests** — `app.test.ts`: `creates a project with empty overlays and zero credits` (`body.overlays` is `[]`, `creditsUsedCents` is `0`), `patches mediaSource` (`PATCH` with `{mediaSource:"stock"}` → 200 and `GET` shows it; `{mediaSource:"magic"}` → 400). `repository.test.ts`: the existing `base` fixture gains `overlays: [], creditsUsedCents: 0` (typecheck fails otherwise) and a new test `update replaces overlays` (Memory repo round-trips an overlay object).
- [ ] **Step 2: Run `npx vitest run backend/app backend/modules/projects` — expect FAIL** (schema/route missing, TS errors on the fixture).
- [ ] **Step 3: Implement contract, types, route, repository mapping, schema lines.**
- [ ] **Step 4: Run `npm run verify` — expect PASS.**
- [ ] **Step 5: Commit** `git commit -am "feat(broll): overlay contract, persistence, media-source switch"`

### Task 2: Beats from shots (pure) and LLM labelling

**Files:**
- Create: `shared/editing/beats.ts`, `shared/editing/beats.test.ts`, `backend/modules/broll/labeler.ts`, `backend/modules/broll/labeler.test.ts`
- Modify: `ai/llm/prompts.ts`, `shared/types.ts` (replace the placeholder `BrollBeat` interface with `z.infer` of the new schema)

**Interfaces:**
- `shared/contract.ts` (small addition, part of this task): `BeatSchema = z.object({ id, shotId, startMs, endMs, placement: OverlayPlacement, media: OverlayMedia })`.
- `deriveBeats(shots: Shot[], opts: { allowVideo: boolean }): Beat[]` — pure; ids `beat-<n>`; rules from Global Constraints; `media` is always `"image"` here (the labeler may upgrade one beat to video when `allowVideo`).
- `BEAT_LABEL_SYSTEM` prompt + `llmBeatSchema(n)` in `ai/llm/prompts.ts`: input `{ beats: [{ i, text }] }` where `text` is the caption text spoken during the beat's shot (first 240 chars); output `{ labels: [{ i, query: string, prompt: string, intent: string, wantsVideo: boolean }] }` with `.max(n)`.
- `labelBeats(llm: Llm, beats: Beat[], phrases: Phrase[], opts: { allowVideo: boolean }): Promise<LabeledBeat[]>` where `LabeledBeat = Beat & { query; prompt; intent }`; normalisation: unknown `i` ignored; a beat without a label gets `query = intent = first 6 words of its shot text`, `prompt = "photo of " + that`; `query` trimmed to 60 chars and stripped of quotes/newlines; when `allowVideo`, the **first** beat with `wantsVideo: true` becomes `media: "video"`, all others stay `image`. Batches of `PLAN_BATCH` (reuse the constant).
- `fakeLlmResponder` in `backend/shared/testing.ts` gains the `beats` branch: `labels: beats.map(b => ({ i: b.i, query: "stock " + b.text.split(" ")[0], prompt: "photo of " + b.text, intent: b.text.split(" ").slice(0,3).join(" "), wantsVideo: b.i === 1 }))`.

- [ ] **Step 1: Write failing tests** — `beats.test.ts`: `one beat per b-roll shot with 300 ms lead and 5 s cap` (shots `[Hook 0–4000, B-Roll 4000–12000, Talking Head 12000–15000, TH&B-Roll 15000–21000]` → beats `[{shotId:"shot-1", startMs:4300, endMs:9300, placement:"full"}, {shotId:"shot-3", startMs:15300, endMs:20300, placement:"top"}]`), `drops beats shorter than 1.5 s` (B-Roll shot of 1600 ms → no beat), `beats never overlap` (property over 20 random contiguous shot lists). `labeler.test.ts`: `labels beats from llm and fills gaps` (FakeLlm omitting one label → fallback query from shot text), `only the first wantsVideo beat becomes video when allowed`, `never video when not allowed`, `normalizes bad llm output` (`i` out of range, query with newlines and 300 chars).
- [ ] **Step 2: Run `npx vitest run shared/editing/beats backend/modules/broll` — expect FAIL**
- [ ] **Step 3: Implement `beats.ts`, prompt + schema, `labeler.ts`, fake responder branch.**
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(broll): beats from shots, LLM labels queries and prompts"`

### Task 3: Provider ports — Pexels, fal.ai, remote import

**Files:**
- Create: `backend/shared/stock.ts`, `backend/shared/stock.test.ts`, `backend/shared/generator.ts`, `backend/shared/generator.test.ts`, `backend/shared/importRemote.ts`, `backend/shared/importRemote.test.ts`
- Modify: `backend/shared/deps.ts`, `backend/shared/testing.ts`, `backend/server/index.ts`, `backend/server/index-lite.ts`, `.env.example`

**Interfaces:**
- `StockResult = { url: string; media: OverlayMedia; width: number; height: number; durationMs?: number; attribution: { author: string; url: string } }`.
- `StockSearch { search(query: string, opts: { media: OverlayMedia; orientation: "portrait" | "landscape"; page?: number }): Promise<StockResult[]> }`; `PexelsStock(apiKey: string, { baseUrl = "https://api.pexels.com", timeoutMs = 15000 })` — photos: `GET /v1/search?query&orientation&per_page=10&page` → `photos[].src.large2x` (`original` when ≥ 1920 wide is not needed), `photographer`, `url`; videos: `GET /videos/search?query&orientation&per_page=10&page&size=medium` → pick `video_files[]` with `file_type === "video/mp4"`, `width ≤ 1920`, `duration ≤ 30`, prefer the largest; `429`/network → throws `Error("stock_unavailable")`; `[]` on no hits. `FakeStock(results: Record<string, StockResult[]>)` returns `results[query] ?? []` and records `calls: { query; opts }[]`.
- `GenerateRequest = { prompt: string; media: OverlayMedia; width: number; height: number; imageUrl?: string }`, `GeneratedMedia = { url: string; media: OverlayMedia; model: string; costCents: number }`.
- `MediaGenerator { generate(req: GenerateRequest): Promise<GeneratedMedia> }`; `FalGenerator(apiKey, { baseUrl = "https://queue.fal.run", timeoutMs = 180000 })` — image: `POST /fal-ai/flux/schnell` `{ prompt, image_size: { width, height }, num_images: 1 }` → `images[0].url`, `costCents = 1`; video: first generate an image for the prompt, then `POST /fal-ai/kling-video/v1.6/standard/image-to-video` `{ prompt, image_url, duration: "5", aspect_ratio }` → `video.url`, `costCents = 25`; queue flow: `POST` returns `{ request_id, status_url, response_url }`, poll `status_url` every 2 s until `COMPLETED`, then `GET response_url`; non-2xx/timeout → `Error("generator_unavailable")`. Model ids: `FAL_IMAGE_MODEL`, `FAL_VIDEO_MODEL` exported constants. `FakeGenerator(urlFor: (req) => string | Error)` records `calls`.
- `importRemote(deps: { storage: Storage; media: Media; id: () => string }, url: string, opts: { expect: OverlayMedia; maxBytes?: number }): Promise<{ key: string; mimeType: string; info: MediaInfo }>` — streams `https:` only into `storage.write(key)` with key `broll/<id>.<ext>`, enforces size and content-type from Global Constraints, probes, removes the file and throws `Error("bad_remote_media")` on any check failure.
- `AppDeps` gains `stock: StockSearch | null; generator: MediaGenerator | null` (null when the key is unset). `makeTestDeps` uses `FakeStock` with two canned results per media type keyed `"stock Here"`, `"stock meditation,"` (whatever the fake labeler produces for the fixture) served from a tiny local http server helper `serveFixtureMedia()` in `backend/shared/apiTestHelpers.ts` (a 1×1 PNG and the fixture mp4 from `tests/`, both generated at test time), and a `FakeGenerator` pointing at the same server. Lite/pg servers construct `PexelsStock(process.env.PEXELS_KEY)` / `FalGenerator(process.env.FAL_KEY)` or `null`.

- [ ] **Step 1: Write failing tests** — `stock.test.ts` against a local `http.createServer` mock of Pexels: `pexels query carries orientation` (asserts the query string has `orientation=portrait`), `maps photo and video results` (exact `StockResult` shape, skips a 4k/45 s video file), `429 throws stock_unavailable`, `no hits returns []`. `generator.test.ts`: `fal image queue flow` (POST → status poll twice → response → `{ url, costCents: 1 }`), `fal video chains image then video and costs 25`, `timeout throws generator_unavailable`. `importRemote.test.ts`: `imports https png into storage`, `rejects http, oversize and wrong content-type`.
- [ ] **Step 2: Run `npx vitest run backend/shared/stock backend/shared/generator backend/shared/importRemote` — expect FAIL**
- [ ] **Step 3: Implement the three modules; wire deps, fakes, servers; add `PEXELS_KEY`/`FAL_KEY` comments to `.env.example`.**
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(broll): Pexels stock, fal.ai generator and remote import ports"`

### Task 4: Overlay timeline and composition layer

**Files:**
- Create: `shared/editing/overlays.ts`, `shared/editing/overlays.test.ts`, `shared/remotion/OverlayLayer.tsx`
- Modify: `shared/editing/renderProps.ts`, `shared/editing/renderProps.test.ts`, `shared/remotion/CaptionVideo.tsx`, `shared/remotion/activeWord.ts` (if a frame helper is needed), `tests/integration/render.test.ts`

**Interfaces:**
- `OverlayProps = { id: string; src: string; media: OverlayMedia; startMs: number; endMs: number; placement: OverlayPlacement; transition: "fade" | "none" }` (output time).
- `overlayTimeline(overlays: Overlay[], cuts: Cut[], assetUrl: (assetId: string) => string): OverlayProps[]` — pure, in `overlays.ts`: keeps `enabled` overlays; maps `[startMs, endMs]` through `mapTime`; an overlay fully inside a removed range is dropped; partial overlap is clipped (result `< 500` ms → dropped); output sorted by `startMs`.
- `CaptionVideoProps` gains `overlays?: OverlayProps[]`; `captionVideoProps(project, { videoSrc, sourceDurationMs, assetUrl })` fills it (new required `assetUrl` option; the server passes `(id) => deps.apiBaseUrl + api.assetFile(id)`, the browser passes `assetFileUrl`).
- `<OverlayLayer overlay={OverlayProps} />` in `OverlayLayer.tsx`: `<Sequence from={frame(startMs)} durationInFrames={frame(endMs) − frame(startMs)}>`; image → `<Img>` with Ken Burns (`scale = interpolate(frame, [0, dur], [1, 1.08])`), video → `<OffthreadVideo muted loop>` (Player: `<Video>`), `cover` fit; `top` placement = absolute box `top: 6%, height: 49%, left: 4%, right: 4%, borderRadius: 16, overflow: hidden`; `full` = `AbsoluteFill`; `fade` = opacity `interpolate(frame, [0, 10, dur − 10, dur], [0, 1, 1, 0])` clamped.
- `CaptionVideo` renders overlays between the base media and the caption block, inside the `<Series>` when segments exist (overlay frames are already in output time, so they sit **outside** the series as siblings in a second `AbsoluteFill` — simpler and correct because `Sequence` positions are absolute).

- [ ] **Step 1: Write failing tests** — `overlays.test.ts`: `overlays follow enabled cuts` (overlay `4300–9300` with an enabled cut `5000–6000` → `4300–8300`; cut `4000–10000` → dropped; disabled cut → unchanged), `drops disabled overlays`, `clips to a minimum of 500 ms`, `sorted by start`. `renderProps.test.ts`: `captionVideoProps includes overlay props with asset urls`. `render.test.ts` (gated `RUN_RENDER=1`): new case `renders a top overlay image under the captions` using a generated 400×600 PNG served by the test http server, asserting the output file exists and is > 10 KB.
- [ ] **Step 2: Run `npx vitest run shared/editing` — expect FAIL**
- [ ] **Step 3: Implement `overlays.ts`, `OverlayLayer.tsx`, the `captionVideoProps` change (update its two callers: `pipeline.ts` `renderOutputs` and `CaptionPreview.tsx`).**
- [ ] **Step 4: Run `npm run verify` — expect PASS; run `npm run render:sample` once — expect PASS and open the MP4: image visible in the top band, captions unobstructed.**
- [ ] **Step 5: Commit** `git commit -am "feat(broll): overlay timeline through cuts and Remotion overlay layer"`

### Task 5: B-roll job and API

**Files:**
- Create: `backend/modules/broll/routes.ts`, `backend/modules/broll/job.ts`, `backend/modules/broll/routes.test.ts`
- Modify: `backend/app/app.ts`, `backend/modules/editplan/routes.ts` (PATCH plan re-renders when a shot kind changes **and** overlays exist — the comment "Shot kinds don't change the render yet" goes away), `backend/modules/pipeline/pipeline.ts` (a fresh `/run` clears `overlays` like it clears the plan), `frontend/src/features/projects/components/StageProgress.tsx` (stage list for `kind: "broll"`)

**Interfaces:**
- `startBrollJob(deps, project, input: { regenerate: boolean }): JobState` — job `kind: "broll"`, status `generating` while it runs, stages/progress: `beats` 10 → `label` 20 → `fetch` 20–80 (per beat, `report(20 + 60·done/total, "fetch")`) → `render` 85 → `subtitles` 95 → 100. Flow: `deriveBeats(editPlan.shots, { allowVideo: mediaSource === "generate" })`; if none → `warnings += "no_broll_shots"`, overlays `[]`, re-render, `ready`. Else `labelBeats`; for each beat: `regenerate: false` keeps an existing overlay with the same `shotId` (and the same media); otherwise resolve media: `generate` mode → `generator.generate` (image: `prompt`, project dims; video: `prompt` + the image it just made) → on `generator_unavailable` fall back to stock; `stock` mode or fallback → `stock.search(query, { media, orientation })`, empty → `search(intent)`, empty → skip with `warnings += "broll_not_found:<beatId>"`; chosen URL → `importRemote` → `assets.create({ kind: media, projectId, … })` → overlay `{ id: "ov-<n>", shotId, assetId, media, source, startMs, endMs, placement, transition: "fade", enabled: true, query, prompt, intent, attribution|generationInfo }`; `creditsUsedCents += costCents`. Missing provider for the mode → throw `stock_unavailable` / `generator_unavailable` **before** touching the project (status returns to previous, like `startPlanJob`). After fetching: save `overlays`, `creditsUsedCents`, `warnings`, then `renderOutputs`, then `ready`.
- Routes (`brollRouter(deps)`, mounted in `app.ts`): `POST /broll {regenerate?}` → `202 {jobId}`, `400 no_plan` (no `editPlan`), `409 busy`; `PATCH /broll {overlays:[…]}` → applies `enabled/startMs/endMs/placement/transition` per id, `400 unknown_id`, `400 out_of_shot` when the new range leaves `[shot.startMs, shot.endMs]`, then `202` re-render job (`startCaptionJob(deps, updated, { transcribe: false, resegment: false })`) — or `200` with the overlays when nothing changed; `DELETE /broll/:overlayId` → removes it, `202` re-render; `POST /broll/:overlayId/replace {assetId}` → asset must exist, `kind ∈ {image, video}`, else `400 bad_asset`; sets `assetId`, `media`, `source: "uploaded"`, clears attribution/generationInfo → `202` re-render; `POST /broll/:overlayId/regenerate {query?, prompt?}` → single-beat job `kind: "broll"` that re-resolves only that overlay (stock: `page + 1` of the same query so the user gets a different result; generate: new fal call) then re-renders → `202`.
- `StageProgress` gets `BROLL_STAGES = [["beats","Beats"],["label","Describing"],["fetch","Fetching media"],["render","Rendering"],["subtitles","Subtitles"]]`.

- [ ] **Step 1: Write failing tests in `routes.test.ts`** (build on `readyProject`, then `POST /plan` with the fake LLM, `untilStatus ready`): `adds overlays for b-roll shots and renders` (2 overlays, `source: "stock"` with attribution for a `mediaSource: "stock"` project; `outputs.mp4AssetId` changed; `FakeRenderer.calls.at(-1).inputProps.overlays` has 2 entries), `generate mode uses the generator and charges credits` (`FakeGenerator` called, `creditsUsedCents > 0`, one `media: "video"` overlay at most), `generation failure falls back to stock` (`FakeGenerator` throwing → overlays are `source: "stock"`, warnings empty), `no b-roll shots completes with a warning` (PATCH all shots to `Talking Head` first), `empty stock result skips the beat` (`FakeStock` with no results for one query → `warnings` contains `broll_not_found:beat-1`, other overlay present), `missing provider fails before changing the project` (`stock: null` → job FAILED `stock_unavailable`, project status still `ready`, overlays unchanged), `patch toggles and retimes with validation` (disable one → 202 and renderer receives 1 overlay; `startMs` outside shot → 400 `out_of_shot`; unknown id → 400), `replace rejects audio and bad ranges` (upload a wav, replace → 400 `bad_asset`; replace with an uploaded png → 202, `source: "uploaded"`), `regenerate asks for the next stock page` (`FakeStock.calls` last entry has `page: 2`), `re-run clears overlays`.
- [ ] **Step 2: Run `npx vitest run backend/modules/broll` — expect FAIL**
- [ ] **Step 3: Implement `job.ts`, `routes.ts`, mount, the two plan-2 touch-ups, `StageProgress` stages.**
- [ ] **Step 4: Run `npm run verify` — expect PASS**
- [ ] **Step 5: Commit** `git commit -am "feat(broll): b-roll job, overlay API, fallbacks and warnings"`

### Task 6: B-roll panel and media-source switch (mobile-first)

**Files:**
- Create: `frontend/src/features/projects/components/BrollPanel.tsx`, `frontend/src/features/projects/components/BrollPanel.test.tsx`
- Modify: `frontend/src/features/projects/api/projects.ts`, `frontend/src/features/projects/components/ProjectPage.tsx`, `frontend/src/features/projects/components/CaptionPreview.tsx` (pass `assetUrl: assetFileUrl`), `frontend/src/features/projects/components/EditPlanPanel.tsx` (shot-kind select hint: "changes B-roll on next Add B-roll")

**Interfaces:**
- `api/projects.ts`: `updateProject(id, { mediaSource })`, `addBroll(id, { regenerate })`, `updateOverlays(id, overlays)`, `deleteOverlay(id, overlayId)`, `replaceOverlay(id, overlayId, assetId)`, `regenerateOverlay(id, overlayId, { query?, prompt? })`.
- `overlayRows(project): { overlay: Overlay; shot: Shot; label: string }[]` (pure, exported for tests) — label `"<kind> · <m:ss>–<m:ss>"`.
- `<BrollPanel project busy onAdd onUpdate onDelete onReplace onRegenerate onSeek />`: header with a **Media source** segmented control (`Generate (fal.ai)` / `Stock only`) calling `updateProject`, disabled while busy; the "Add B-roll" button (label "Refresh B-roll" when overlays exist, with a `regenerate` checkbox "Replace existing"); a warning line for `no_broll_shots` ("Mark shots as B-Roll in the edit plan first") and `broll_not_found:*` ("No media found for <n> beat(s)"); one row per overlay: 64 px thumbnail (`<img>`/`<video muted>` from `assetFileUrl`), label, `enabled` switch, placement select (`Full / Top`), `−/+ 0.5 s` end-time buttons (clamped to the shot), **Replace** (hidden `<input type=file accept="image/*,video/mp4">` → `uploadFile` → `onReplace`), **Regenerate** (stock: next result; generate: prompt editable inline first), delete, and the attribution link for stock. Credits line at the bottom when `creditsUsedCents > 0` (`"$0.26 used"`). All controls ≥ 44 px; one column under `md`.
- `ProjectPage` renders `<BrollPanel>` under the `EditPlanPanel` when `p.editPlan` exists; `busy` includes the new mutations; the `broll` job kind drives `StageProgress`.

- [ ] **Step 1: Write failing tests** — `BrollPanel.test.tsx` (existing `EditPlanPanel.test.tsx` shows the testing-library setup): `overlayRows labels overlays with their shot`, `shows the no_broll_shots hint`, `end-time buttons clamp to the shot` (clicking `+` at the shot end does not call `onUpdate`), `replace with an audio file shows an error without calling onReplace`.
- [ ] **Step 2: Run `npx vitest run frontend/src/features/projects/components/BrollPanel` — expect FAIL**
- [ ] **Step 3: Implement the API functions, panel, page wiring, preview `assetUrl`.**
- [ ] **Step 4: Run `npm run verify` and `npm run build` — expect PASS. Manual check with `FAKE_AI=1 npm run dev:lite` + `npm run dev` at 375 px and desktop: plan → Add B-roll → overlays appear in the preview → disable one → re-render → replace one with an uploaded image → download MP4.**
- [ ] **Step 5: Commit** `git commit -am "feat(web): b-roll panel with media source, toggles, replace and regenerate"`

### Task 7: Docs and run recipe

**Files:**
- Modify: `PROJECT.md` (State: plan 3 done; keys needed; costs; unapplied migration note), `docs/superpowers/plans/README.md` (row 3 ✅, row 4 next), `.env.example` (comments: Pexels free key URL, fal pricing of the two models)

- [ ] **Step 1: Update the three docs.**
- [ ] **Step 2: Run `npm run verify` — expect PASS**
- [ ] **Step 3: Commit** `git commit -am "docs: plan 3 complete"`

---

## Self-review notes

- Spec coverage for this slice: 11.7 (fal default, per-project Stock-only switch → Task 1 route + Task 5 mode rule), 11.8d images **and** video (Task 3 fal video + Task 5 one-video rule; stock videos via Pexels), 11.9 credit ledger (`creditsUsedCents`, no billing), 11.1 mobile (Task 6), 11.2 (remote media copied into `DATA_DIR`; no new trackers). Deferred to plan 4: touch timeline drag of overlays (here: ±0.5 s buttons), consent banner, demo project. Deferred to plan 5: retention sweep of imported media, S3 storage.
- Type consistency: `Overlay` (Task 1) is consumed by `overlayTimeline` (Task 4), the job (Task 5) and the panel (Task 6); `Beat`/`LabeledBeat` (Task 2) only by Task 5; `captionVideoProps` gains the `assetUrl` option in Task 4 and both callers are updated there, so Tasks 5–6 see one signature; `StageProgress` `kind: "broll"` matches the job kind in Task 5.
- Review Focus items 1–6 each have a named test (Tasks 3, 4, 5).
- Plan-2 touch-ups are explicit (PATCH plan re-render on shot-kind change when overlays exist; `/run` clears overlays) so the ledger needs no ruling for them.
