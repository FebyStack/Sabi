# Rebuild Blueprint (senior-architect framing)

Goal: a web app that (1) auto-captions a talking-head video with word-level timing and styled templates, and (2) auto-generates + places image/video B-roll from the transcript, with a manual "generate from prompt" path. Scalable, maintainable, solo-dev friendly. Uses Febriel's hybrid architecture (React+Vite / Node+Express / Postgres / Docker).

## 10.1 Folder structure
```
captions-clone/
  frontend/            # React 18 + Vite + TS, TanStack Router/Query, Zustand, Tailwind + tokens
    src/app/           # routes: /, /projects, /p/:id (editor), /p/:id/plan
    src/features/      # upload, transcript, captions, broll, editor, export, billing
    src/components/ui/ # Radix-based primitives
    src/lib/           # api client (zod-typed), sse, media utils
  backend/             # Node 22 + Express + TS, zod, Prisma, BullMQ
    src/modules/       # assets, projects, transcription, editplan, captions, broll, render, credits, auth
    src/workers/       # queue consumers (transcribe, plan, generate, render)
    src/providers/     # asr/, llm/, imagegen/, videogen/, stock/  (adapter interfaces)
  ai/                  # prompt templates, eval fixtures, planner schemas (JSON)
  shared/              # zod schemas + TS types shared FE/BE (CaptionTrack, EditPlan, Overlay)
  database/            # prisma schema, migrations, seed
  infrastructure/      # docker-compose, Dockerfiles, nginx, env templates
  PROJECT.md
```

## 10.2 Component architecture (frontend)
- `UploadDropzone` → tus/multipart uploader (resumable, chunked) → `AssetCard`.
- `EditPlanReview` (server-driven form like Captions' `sections[]`): `OutlineSegments` (recommended cuts, toggle `shouldTrim`), `StyleGrid`, `MediaInserts` (custom media + "generate B-roll" toggle + intensity).
- `Editor`: `PreviewPlayer` (HTML5 video + canvas overlay compositor for preview), `Timeline` (tracks: video, captions, overlays, music), `CaptionsPanel` (phrase list, word chips, per-word effects), `BrollPanel` (beats list, regenerate/replace/stock search), `ChatPanel` (optional phase 2).
- `ExportDialog` (resolution/fps/bitrate, SRT).
- Pattern: feature folders own hooks (`useCaptions`, `useBrollBeats`), server state via TanStack Query, local UI state via Zustand slices, SSE for job progress.

## 10.3 Backend pipeline (mirrors Captions, simplified)
1. **Ingest**: presigned multipart to S3/R2 → `ffprobe` metadata → transcode proxy (720p H.264) + audio WAV 16 kHz.
2. **Transcribe** (ASR adapter): word timestamps + confidence. Providers: Deepgram Nova-3 / AssemblyAI (hosted) or `whisperX` (self-host, forced alignment). Output `Transcript{words[{text, start, end, conf}]}`.
3. **Edit plan** (LLM adapter, provider-agnostic — OpenAI/Gemini/local; *not* Anthropic API per billing rule): input transcript + duration + style; output strict JSON `EditPlan{summary, outline[{id,start,end,text,shouldTrim}], brollBeats[{start,end,intent,imagePrompt,videoPrompt?,stockQuery,placement}], emphasis{keywords[],nouns[],pictorial[]}}`. Validate with zod; retry on schema fail. Filler/pause cuts from ASR gaps (>0.6 s) + filler-word lexicon, not LLM.
4. **Captions**: deterministic segmenter → phrases/pages from template params (`maxCharsPerLine, maxWordsPerLine, maxLines, pauseSplitSec`), karaoke active-word timing from words. Template = JSON (not protobuf) with same property groups as Captions.
5. **B-roll**: for each beat → `stock` (Pexels/Pixabay API, free) or `generate` (fal.ai Flux / Imagen via Vertex; video via Kling/Veo through fal) → store asset → `Overlay{beatId, assetId, start, end, placement, transition}`. Placement rule: never cover caption safe-zone (caption-aware), max 1 overlay/beat, 2–5 s, density by intensity.
6. **Render**: Remotion (React compositions: captions + overlays + zooms) rendered server-side with `@remotion/renderer` in a worker; or FFmpeg filtergraph for captions-only (ASS subtitles via libass) as the cheap path. Preview in-browser uses the same React composition via `@remotion/player` → one source of truth.
7. **Jobs**: BullMQ on Redis; each stage a job with `state QUEUED|PROCESSING|COMPLETE|FAILED|CANCELED`, `progress`; SSE endpoint per project streams job + "mutation proposals" (generated overlay to insert). Temporal only if workflows grow beyond ~5 stages.
8. **Chat agent (phase 2, copy Captions' loop)**: one tool-calling LLM with five tools — `inspect_project` (jq over the project JSON), `model_catalog`, `generate_assets`, `apply_actions` (typed action list validated server-side, applied as one commit with `baseVersion`), `render_frame` (returns a PNG the model inspects to verify placement). Actions v1: `upsertAsset, insertImageLayer, insertVideoLayer, setLayerTransform, updateLayer, deleteLayer, editPhrase`. Shot taxonomy for the planner: `Hook | B-Roll | Talking Head | Talking Head & B-Roll`.

## 10.4 Data model (Postgres/Prisma)
`User, Org, CreditLedger, Project{status, aspectRatio, styleId}, Asset{kind, url, meta}, Transcript{words jsonb}, EditPlan{sections jsonb, values jsonb, version}, CaptionTrack{templateId, phrases jsonb}, Overlay{beat, assetId, placement}, RenderJob{kind, state, progress, outputAssetId}`. jsonb for word/phrase arrays (append-only edits create new versions).

## 10.5 Design system
Tokens (CSS vars): neutral dark editor surface + 1 accent; 4 type scales; 4 radii; motion 150/250 ms. Radix primitives + Tailwind; caption-template previews rendered from the same canvas renderer as the editor. Follow `high-end-visual-design` skill on marketing pages only.

## 10.6 Responsive
Editor: desktop-first (≥1024), tablet read-only review, mobile = upload + plan review + export only (Captions keeps full editing on iOS native, not mobile web). Marketing: fluid, phone gutter 16 px.

## 10.7 State management
Server state: TanStack Query (keys per project/job). Editor doc: Zustand with immer + undo stack; persist via explicit `commit` endpoint with `baseVersion` optimistic concurrency (CRDT only if multi-user editing is a real requirement — skip Yjs for MVP).

## 10.8 SEO
Marketing pages SSG (Astro or Next static) separate from the SPA; per-feature landing pages (`/features/auto-captions`, `/tools/ai-b-roll-generator`), `llms.txt`, OpenGraph video previews, sitemap, JSON-LD `SoftwareApplication`. App routes `noindex`.

## 10.9 Performance
Chunked uploads; transcode proxy for preview; lazy-load editor chunks (Captions ships 152 chunks); workers off the API process; cache model catalogs; generated media as WebP/AV1 variants; SSE instead of polling (Captions still polls several endpoints — avoid).

## 10.10 Accessibility
Keyboard-first timeline (arrow nudge, J/K/L), ARIA roles on tracks, caption contrast check against template bg, reduced-motion disables auto-movement/scale effects, focus trapping in dialogs (Radix).

## 10.11 Analytics
PostHog (self-host or cloud): funnel upload→plan→render→export; per-job latency/cost; feature flags for model routing. Session replay off by default (privacy/consent).

## 10.12 Deployment
Docker Compose: `web` (nginx static), `api`, `worker-cpu` (ffmpeg, remotion), `postgres`, `redis`, `minio` (dev) → prod S3/R2. GPU not needed (generation via hosted APIs). CI: typecheck + zod schema snapshot tests + a golden render test on a 10 s fixture. Migrations run in CI/entrypoint and reported.

## 10.13 Trade-offs
- **Server render (Remotion/FFmpeg) vs Captions' in-browser Rust/WASM+WebGPU engine**: theirs gives instant preview and free client compute; costs a Rust team. Remotion gives one React codebase for preview+export; slower exports, server cost. Pick Remotion for MVP; revisit WebCodecs export later.
- **JSON templates vs protobuf**: JSON = debuggable; protobuf = compact/versioned. JSON. (Captions itself wraps a JSON timeline inside a protobuf envelope — the hybrid buys nothing for an MVP.)
- **PAG motion-graphics templates vs React (Remotion) components**: PAG gives designer-authored After Effects animations with image/text/color slots and runs in Rust/WASM; Remotion keeps everything in TypeScript. Start with Remotion components exposing the same slot contract (`imageSlots/textSlots/colorSlots`) so PAG can be added later.
- **LLM planner vs heuristics**: keep cuts/pauses heuristic (deterministic, free), use LLM only for beats/prompts/emphasis (one call per video).
- **Stock-first B-roll** keeps per-video cost near zero; generation gated by credits.
- **Polling vs SSE**: SSE; fall back to polling on proxies that buffer.



See `docs/spec.md` for the locked spec and `~/Desktop/Reverse Engineer/captions-ai-reverse-engineering.md` §1–9 for the evidence.
