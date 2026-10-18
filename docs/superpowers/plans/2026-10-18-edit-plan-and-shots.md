# Edit Plan & Shots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After captions are ready, the user runs "Plan edit": heuristic filler/pause cuts they can toggle, LLM-typed shots on a scrubber, emphasis-coloured words, auto emoji, and translated subtitle tracks (SRT/VTT, optionally burned in) — and the MP4 re-renders with the enabled cuts.

**Architecture:** Cuts are pure functions over ASR word gaps (`shared/editing/cuts.ts`); the LLM (Ollama behind an injected `Llm` port, `FakeLlm` in tests) only labels — shots, emphasis, emoji — and translates, always through zod-validated JSON with one retry. Edits live on the project (`editPlan`, per-word `emphasis`, per-phrase `emoji`, `translations`) in source time; one shared `captionVideoProps()` maps them onto the cut timeline for both the server render and the browser preview, so preview = export.

**Tech Stack:** existing (Express 5, zod 4 incl. `z.toJSONSchema`, Remotion 4.0.536 `<Series>` + `trimBefore`, React 19, TanStack Query, Tailwind 4) + Ollama HTTP API (`POST /api/chat` with `format` = JSON schema). No new npm dependencies.

**Spec:** `docs/spec.md` §8 (a: emphasis + auto emoji, b: translated subtitle tracks, c: filler/pause cuts + typed shots), §1 (mobile), §7 (Ollama, no Anthropic API); `docs/blueprint.md` §10.3 step 3 and §10.13 ("keep cuts/pauses heuristic … LLM only for … emphasis"). Conventions: `PROJECT.md`.

## Global Constraints

- **No Anthropic API anywhere.** LLM = Ollama at `OLLAMA_URL` (default `http://localhost:11434`), model `OLLAMA_MODEL` (default `qwen2.5:3b` — ~1.9 GB, multilingual, fast enough on a base Apple-Silicon chip; `qwen2.5:7b` (4.7 GB, fits 16 GB RAM) is the translation-quality upgrade, one env var away). Ollama is **not installed**: `brew install ollama` (CLI only — the menu-bar app autostarts its own server with models on the Mac disk and would eat the ~5 GB free). Model blobs live on the SSD via `OLLAMA_MODELS=$DATA_DIR/ollama`, so `ollama pull` must run while `npm run ai:ollama` is the server on :11434. Structured output (`format` = JSON schema) needs Ollama ≥ 0.5; every array the LLM emits carries `maxItems` so a looping small model is cut off by the grammar, not by a timeout.
- Cuts are never decided by the LLM: pause = ASR gap > `600` ms, trimmed to leave `150` ms padding next to speech (none at `0` / the clip end); filler = word whose letters-only lowercase form is in `um uh umm uhm erm er ah hmm mm`. Leading/trailing silence uses the same rule against `0` and the source duration. A clip with no non-filler word (silence, or "um" only) gets no cuts.
- Durations: the source asset's `durationMs` is the truth for cuts and renders; `project.sourceDurationMs` is a copy for the UI (scrubber, preview length).
- Shot kinds exactly `Hook | B-Roll | Talking Head | Talking Head & B-Roll`; emphasis kinds exactly `noun | keyword | pictorial`.
- Translation targets: `en es fr de pt it ja ko zh hi tl id` (names in `LANGUAGE_NAMES`), at most 3 per plan; a target equal to the transcript language is skipped.
- Single wire contract: every new schema lives in `shared/contract.ts`; `shared/types.ts` only re-exports `z.infer` types.
- `/run` stays captions-only and must keep working with Ollama down; planning is its own job (`kind: "plan"`).
- Mobile-first: every control ≥ 44 px, one column under 768 px.
- TDD, colocated `*.test.ts`; `npm run verify` green after every task. Backend imports stay relative.
- `database/schema/schema.sql` changes are `ADD COLUMN IF NOT EXISTS` and apply on api boot; Docker is not running now, so say so in PROJECT.md (unapplied until `make db && npm run dev:server`). The Pg repository has no live test: the `COL` record type (`Record<keyof Project, …>`) is what forces every new field to get a column mapping.

## Review Focus

1. **Ollama not running / model not pulled** — the plan job fails with `llm_unavailable` / `llm_model_missing`, the project returns to its previous status (`ready`) with its existing MP4/SRT/VTT, and the error shows on the page. → Task 6 test `plan failure keeps previous outputs`.
2. **Small model returns sloppy JSON** — out-of-range phrase indices, words not in the phrase, `"smile"` instead of an emoji, unsorted/duplicate shots, every word emphasised: ignored or clamped, shots still contiguous over `[0, duration]`, ≤ 2 emphasised words per phrase. → Task 4 test `normalizes out-of-range llm output`.
3. **Silence-only, filler-only or no-speech clip** — no cuts (never cut the whole clip); `POST /plan` on a project without phrases is `400 no_captions`. → Task 2 test `no words or only fillers, no cuts`; Task 6 test `rejects plan without captions`.
4. **Edits after planning** — template change keeps emphasis, emoji and translations; a fresh `/run` (new transcript) clears plan, translations and burn-in. → Task 6 test `template change keeps plan data; re-run clears it`.
5. **One timeline for every output** — with enabled cuts the MP4 duration, burned captions and all SRT/VTT tracks use the cut timeline; translated tracks lose no words to filler cuts. → Task 5 test `subtitles follow enabled cuts`.

---

### Task 1: Contract and persistence

**Files:**
- Modify: `shared/contract.ts`, `shared/types.ts`, `backend/modules/projects/routes.ts`, `backend/modules/projects/repository.ts`, `backend/modules/projects/repository.test.ts`, `backend/app/app.test.ts`, `backend/modules/pipeline/routes.ts`, `backend/modules/pipeline/pipeline.test.ts`, `database/schema/schema.sql`, `.gitignore` (the three test edits are already in the working tree, uncommitted — keep them)

**Interfaces:**
- Produces in `shared/contract.ts`:
  - `EmphasisKind = z.enum(["noun","keyword","pictorial"])`; `SHOT_KINDS` + `ShotKind = z.enum(SHOT_KINDS)`.
  - `WordSchema` + `emphasis: EmphasisKind.optional()`; `PhraseSchema` + `emoji: z.string().max(16).optional()`.
  - `CutSchema = { id, startMs, endMs, reason: z.enum(["pause","filler"]), text: string, shouldTrim: boolean }`; `ShotSchema = { id, kind: ShotKind, startMs, endMs }`; `EditPlanSchema = { cuts: Cut[], shots: Shot[] }`.
  - `LANGUAGE_NAMES = { en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ja: "Japanese", ko: "Korean", zh: "Chinese (Simplified)", hi: "Hindi", tl: "Tagalog", id: "Indonesian" }`; `TranslationLanguage = z.enum(<its keys>)`; `TranslationSchema = { language: TranslationLanguage, phrases: Phrase[] }`.
  - `ProjectSchema` + `sourceDurationMs: number|null`, `editPlan: EditPlan|null`, `translations: Translation[]`, `burnInLanguage: TranslationLanguage|null`; `outputs` + `translations?: { language, srtAssetId, vttAssetId }[]`.
  - `PlanInput = { languages: TranslationLanguage[] (max 3, default []), burnInLanguage: TranslationLanguage|null (default null) }`, refined: burn-in ∈ languages.
  - `UpdatePlanInput = { cuts: {id, shouldTrim}[] (default []), shots: {id, kind}[] (default []), burnInLanguage?: TranslationLanguage|null }`.
  - `api.projectPlan(id) = /api/projects/${id}/plan`.
- `shared/types.ts`: `Phrase`, `ShotKind`, `Shot` become `z.infer`; add `EmphasisKind, Cut, EditPlan, Translation, TranslationLanguage, PlanInput (z.input), UpdatePlanInput (z.input)`.

- [ ] **Step 1: Failing tests** — `repository.test.ts` `base` gains the four new fields; in `app.test.ts`:

```ts
it("new projects start with no plan, translations or burn-in", async () => {
  const { body } = await request(app()).post("/api/projects").send({ title: "t" });
  expect(body).toMatchObject({ sourceDurationMs: null, editPlan: null, translations: [], burnInLanguage: null });
});
it("PlanInput rejects burn-in of an untranslated language", () => {
  expect(PlanInput.safeParse({ languages: ["es"], burnInLanguage: "fr" }).success).toBe(false);
  expect(PlanInput.safeParse({ languages: ["es", "fr", "de", "ja"] }).success).toBe(false);
  expect(PlanInput.parse({})).toEqual({ languages: [], burnInLanguage: null });
});
```
and in `pipeline.test.ts`: `it("source stores the probed duration")` → `projectWithSource(makeTestDeps())` → `project.sourceDurationMs === 21000`.
- [ ] **Step 2: Run `npx vitest run backend` — FAIL** (fields missing).
- [ ] **Step 3: Implement** the schemas; project create defaults; `/source` sets `sourceDurationMs: asset.durationMs ?? null` and clears `editPlan: null, translations: [], burnInLanguage: null` (a plan belongs to one source); Pg: `COL`/`JSON_COLS`/`toProject`/`create` for `source_duration_ms INTEGER`, `edit_plan JSONB`, `translations JSONB NOT NULL DEFAULT '[]'`, `burn_in_language TEXT` (+ the four `ALTER TABLE … ADD COLUMN IF NOT EXISTS` lines); `.gitignore`: `node_modules` (no slash, so a symlinked worktree `node_modules` is ignored) and `.claude/worktrees/`.
- [ ] **Step 4: `npm run verify` — PASS.**
- [ ] **Step 5: Commit** `feat(contract): edit plan, cuts, shots, emphasis, emoji, translations`

### Task 2: Heuristic cuts and the cut timeline

**Files:**
- Create: `shared/editing/cuts.ts`, `shared/editing/cuts.test.ts`

**Interfaces:**
- Produces: `PAUSE_MIN_MS = 600`, `PAUSE_PAD_MS = 150`, `type Segment = { startMs: number; endMs: number }`;
  `detectCuts(words: Word[], durationMs: number): Cut[]` (sorted, ids `cut-0…`, all `shouldTrim: true`, pause `text: ""`, filler `text` = the word; `[]` when no word is a non-filler — padding would otherwise leave a sliver of an "um"-only clip);
  `keptSegments(durationMs: number, cuts: Cut[]): Segment[]` (complement of merged `shouldTrim` cuts);
  `mapTime(ms: number, cuts: Cut[]): number` (source → output ms; a time inside a cut maps to the cut's start);
  `applyCuts(phrases: Phrase[], cuts: Cut[], dropCutWords = true): Phrase[]` (remaps word + phrase times; drops words fully inside an enabled cut when `dropCutWords`; drops phrases left empty).

- [ ] **Step 1: Failing tests**

```ts
const w = (id: string, text: string, startMs: number, endMs: number) => ({ id, text, startMs, endMs });
it("detects pauses longer than 600 ms, padded 150 ms", () => {
  expect(detectCuts([w("a", "Hi", 0, 500), w("b", "there", 1500, 2000)], 2000))
    .toEqual([{ id: "cut-0", startMs: 650, endMs: 1350, reason: "pause", text: "", shouldTrim: true }]);
});
it("detects filler words", () => {
  expect(detectCuts([w("a", "So", 0, 300), w("b", "Um,", 300, 600), w("c", "yes", 600, 900)], 900))
    .toEqual([{ id: "cut-0", startMs: 300, endMs: 600, reason: "filler", text: "Um,", shouldTrim: true }]);
});
it("cuts leading and trailing silence", () => {
  expect(detectCuts([w("a", "Hi", 1000, 2000)], 5000).map((c) => [c.startMs, c.endMs])).toEqual([[0, 850], [2150, 5000]]);
});
it("no words or only fillers, no cuts", () => {
  expect(detectCuts([], 10_000)).toEqual([]);
  expect(detectCuts([w("a", "Um", 1000, 1500)], 3000)).toEqual([]); // leading + filler + trailing would remove everything
});
it("keptSegments complements enabled cuts only", () => {
  const cuts = [cut(1000, 1500, true), cut(2000, 2500, false)];
  expect(keptSegments(3000, cuts)).toEqual([{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 3000 }]);
});
it("mapTime shifts by removed time", () => {
  const cuts = [cut(1000, 1500, true)];
  expect([500, 1200, 2000].map((t) => mapTime(t, cuts))).toEqual([500, 1000, 1500]);
});
it("applyCuts drops cut words, shifts the rest, drops empty phrases", () => { /* filler [300,600] inside phrase 0; phrase 1 only "Um" → gone; later word −300 ms */ });
it("applyCuts keeps every word when dropCutWords is false", () => { /* same input, words.length unchanged, the cut word has startMs === endMs */ });
```
(`cut(s, e, on)` = a `Cut` literal with `reason: "pause"`.)
- [ ] **Step 2: Run `npx vitest run shared/editing` — FAIL.**
- [ ] **Step 3: Implement `cuts.ts`.** `mapTime` = `ms − Σ overlap(enabled merged cut, [0, ms])`.
- [ ] **Step 4: `npm run verify` — PASS.**
- [ ] **Step 5: Commit** `feat(editing): heuristic filler/pause cuts and cut-timeline mapping`

### Task 3: Ollama LLM adapter

**Files:**
- Create: `backend/shared/llm.ts`, `backend/shared/llm.test.ts`
- Modify: `backend/shared/deps.ts`, `backend/shared/testing.ts`, `backend/server/index.ts`, `.env.example`, `package.json`, `.claude/launch.json`

**Interfaces:**
- Produces: `type LlmRequest = { system: string; user: string; format: Record<string, unknown> }`; `interface Llm { chat(req: LlmRequest): Promise<string> }`;
  `class OllamaLlm(baseUrl: string, model: string, opts?: { timeoutMs?: number })` — `POST ${baseUrl}/api/chat` body `{ model, stream: false, format, options: { temperature: 0, num_ctx: 8192 }, messages: [{role:"system"}, {role:"user"}] }` → `message.content`; HTTP 404 → `Error("llm_model_missing")`; anything else failing (down, non-2xx, timeout default 10 min, body without `message.content` string) → `Error("llm_unavailable")`;
  `class FakeLlm(respond: (req: LlmRequest) => unknown)` with `calls: LlmRequest[]` (non-string answers are `JSON.stringify`ed; a thrown error propagates);
  `askJson<T>(llm: Llm, schema: z.ZodType<T>, system: string, input: unknown): Promise<T>` — `user = JSON.stringify(input)`, `format = z.toJSONSchema(schema)`, 2 attempts (JSON.parse + safeParse); the second attempt's `user` is the first plus `"\n\nYour previous answer was rejected: <'not JSON' | first zod issue>. Answer again."` (at temperature 0 an identical prompt would just repeat the bad answer); then `Error("llm_invalid_output")`; transport errors are not retried.
- `AppDeps.llm: Llm`. `makeTestDeps` → `new FakeLlm(fakeLlmResponder)`; `fakeLlmResponder` (exported from `testing.ts`, deterministic from the request input): translation input `{language, lines}` → `{ lines: lines.map(l => `${language}: ${l}`) }`; plan input `{phrases:[{i,text}]}` → shots `from` every 3rd phrase (kinds cycle `Hook`, then `Talking Head`/`B-Roll`), emphasis = first word of every phrase as `keyword`, emoji `🔥` on every phrase with `i % 3 === 0`.
- `makeMemoryDeps` and `index.ts`: `new OllamaLlm(process.env.OLLAMA_URL ?? "http://localhost:11434", process.env.OLLAMA_MODEL ?? "qwen2.5:3b")`; `makeMemoryDeps` with `FAKE_AI=1` uses `FakeTranscriber(sample)` + `FakeLlm(fakeLlmResponder)` so the UI can be driven without whisperX/Ollama.
- `package.json` `"ai:ollama": "OLLAMA_MODELS=${DATA_DIR:-/Volumes/PortableSSD/Bong/captions-clone-data}/ollama ollama serve"`; launch.json entry `ollama` (port 11434); `.env.example` `OLLAMA_MODEL=qwen2.5:3b` with a comment naming `qwen2.5:7b` as the quality upgrade. Install/pull order (also goes into PROJECT.md): `brew install ollama` → `npm run ai:ollama` in its own tab → `ollama pull qwen2.5:3b` (served by that instance, so the blob lands on the SSD).

- [ ] **Step 1: Failing tests** (stub server like `transcriber.test.ts`, capturing the request):

```ts
it("posts model, schema and messages to /api/chat and returns the content", async () => {
  // stub answers 200 {message:{role:"assistant",content:'{"ok":true}'}}
  const out = await new OllamaLlm(url, "qwen2.5:3b").chat({ system: "S", user: "U", format: { type: "object" } });
  expect(out).toBe('{"ok":true}');
  expect(seen.path).toBe("/api/chat");
  expect(seen.body).toMatchObject({ model: "qwen2.5:3b", stream: false, format: { type: "object" }, options: { temperature: 0 },
    messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] });
});
it("maps a 404 to llm_model_missing", …);
it("maps 500, timeout and a down server to llm_unavailable", …);
it("askJson retries once on invalid output", async () => {
  let n = 0;
  const llm = new FakeLlm(() => (n++ === 0 ? "not json" : { ok: true }));
  expect(await askJson(llm, z.object({ ok: z.boolean() }), "S", { a: 1 })).toEqual({ ok: true });
  expect(llm.calls).toHaveLength(2);
  expect(llm.calls[0].user).toBe('{"a":1}');
  expect(llm.calls[1].user).toContain("rejected");
});
it("askJson throws llm_invalid_output after two bad answers", …);
```
- [ ] **Step 2: Run `npx vitest run backend/shared/llm` — FAIL.**
- [ ] **Step 3: Implement** `llm.ts` and the wiring above.
- [ ] **Step 4: `npm run verify` — PASS.**
- [ ] **Step 5: Commit** `feat(llm): Ollama adapter with strict-JSON helper and FakeLlm`

### Task 4: Planner and translator (LLM labels only)

**Files:**
- Create: `ai/llm/prompts.ts`, `backend/modules/editplan/planner.ts`, `backend/modules/editplan/planner.test.ts`, `shared/captions/retime.ts`
- Modify: `frontend/src/features/projects/components/PhraseEditor.tsx` (import `retimePhrase` from `@shared/captions/retime`; keep re-export so `PhraseEditor.test.ts` stays unchanged)

**Interfaces:**
- Consumes: `askJson`, `Llm` (Task 3); `Phrase`, `Shot`, `TranslationLanguage`, `LANGUAGE_NAMES` (Task 1).
- Produces in `ai/llm/prompts.ts`: `PLAN_SYSTEM: string` (defines the four shot kinds — Hook only at the opening, change shot every 2–6 phrases; ≤ 2 emphasis words per phrase copied verbatim with kind `noun` = concrete thing, `keyword` = key idea, `pictorial` = something you can picture; emoji on about one phrase in three, only where it fits); `translateSystem(languageName: string): string` (same meaning and tone, one output line per input line, no notes); `llmPlanSchema(n) = z.object({ shots: {from: int, kind: ShotKind}[] (max n), emphasis: {phrase: int, word: string, kind: EmphasisKind}[] (max 2n), emoji: {phrase: int, emoji: string}[] (max n) })` for a batch of `n` phrases; `llmLinesSchema(n) = z.object({ lines: z.array(z.string()).length(n) })`. zod 4 emits `.length/.max` as `minItems/maxItems` (verified), which Ollama's grammar enforces.
- Produces in `planner.ts`: `PLAN_BATCH = 60`, `TRANSLATE_BATCH = 40`;
  `planEdit(llm: Llm, phrases: Phrase[], durationMs: number): Promise<{ shots: Shot[]; phrases: Phrase[] }>` — input per batch `{ phrases: [{ i, text }] }` with global `i`; clears old `emphasis`/`emoji`, then normalizes:
  shots → keep integer `from` in range, sort, first per `from` wins, earliest `from` forced to 0, a `Hook` not at 0 becomes `Talking Head` (Hook = the opening only), merge consecutive equal kinds; `startMs` = 0 for the first else `phrases[from].startMs`, `endMs` = next start or `max(durationMs, last phrase end)`; ids `shot-0…`; none valid → one `Talking Head` shot.
  emphasis → phrase in range, word matched by letters/digits-only lowercase against that phrase's unflagged words, ≤ 2 per phrase.
  emoji → phrase in range, first grapheme (`Intl.Segmenter`) must match `/\p{Extended_Pictographic}/u`, first per phrase wins.
  `translatePhrases(llm: Llm, phrases: Phrase[], language: TranslationLanguage): Promise<Phrase[]>` — batches input `{ language: LANGUAGE_NAMES[language], lines }`; each line → `retimePhrase({ ...src, lineBreaksAfter: [] }, line.trim() || sourceText)` with `emphasis` stripped from every word (same word count keeps the source words' timings — and would keep their flags), `emoji` kept. Known limit, accepted: `ja`/`zh` have no spaces, so a translated phrase is one "word" (karaoke highlights the whole line; CSS wraps it).
- `shared/captions/retime.ts`: `retimePhrase(phrase: Phrase, text: string): Phrase` moved verbatim from `PhraseEditor.tsx`.

- [ ] **Step 1: Failing tests** (phrases = `segmentCaptions(sample.words, getCaptionTemplate("clean").layout)` → 9 phrases, `phrases[2].startMs === 4259`; duration 21000; the 130- and 45-phrase inputs repeat the sample phrases with fresh ids):

```ts
it("turns llm shots into contiguous ms ranges covering the clip", async () => {
  const llm = new FakeLlm(() => ({ shots: [{ from: 0, kind: "Hook" }, { from: 2, kind: "Talking Head" }, { from: 4, kind: "B-Roll" }], emphasis: [], emoji: [] }));
  const { shots } = await planEdit(llm, phrases, 21000);
  expect(shots.map((s) => s.kind)).toEqual(["Hook", "Talking Head", "B-Roll"]);
  expect(shots[0]).toMatchObject({ startMs: 0, endMs: phrases[2].startMs });
  expect(shots.at(-1)!.endMs).toBe(21000);
  shots.slice(1).forEach((s, i) => expect(s.startMs).toBe(shots[i].endMs));
});
it("applies emphasis and emoji to the named phrases", async () => {
  // emphasis [{phrase:0, word:"routines", kind:"pictorial"}], emoji [{phrase:1, emoji:"🧘"}]
  expect(out.phrases[0].words.find((w) => w.text === "routines.")?.emphasis).toBe("pictorial");
  expect(out.phrases[1].emoji).toBe("🧘");
});
it("normalizes out-of-range llm output", async () => {
  // shots [{from:99,"B-Roll"},{from:3,"Hook"},{from:3,"B-Roll"}]; emphasis: phrase 99, word "banana", 4 real words of phrase 0; emoji [{phrase:0, emoji:"smile"}]
  expect(shots).toEqual([{ id: "shot-0", kind: "Hook", startMs: 0, endMs: 21000 }]);
  expect(out.phrases[0].words.filter((w) => w.emphasis)).toHaveLength(2);
  expect(out.phrases[0].emoji).toBeUndefined();
});
it("batches long transcripts with global phrase indices", async () => { /* 130 phrases → 3 calls; JSON.parse(calls[1].user).phrases[0].i === 60 */ });
it("translates in batches and keeps phrase timing", async () => {
  // 45 phrases, fakeLlmResponder → 2 calls; out[i].startMs/endMs === src; text starts "Spanish: "; no word has emphasis; emoji kept
});
it("fails with llm_invalid_output when a batch returns the wrong line count", async () => {
  await expect(translatePhrases(new FakeLlm(() => ({ lines: ["x"] })), phrases.slice(0, 3), "es")).rejects.toThrow("llm_invalid_output");
});
```
- [ ] **Step 2: Run `npx vitest run backend/modules/editplan` — FAIL.**
- [ ] **Step 3: Implement** prompts, planner, retime move.
- [ ] **Step 4: `npm run verify` — PASS.**
- [ ] **Step 5: Commit** `feat(editplan): LLM shot/emphasis/emoji labelling and translation with normalization`

### Task 5: Render the plan (emphasis colours, emoji, cuts, burn-in, translated subtitles)

**Files:**
- Create: `shared/editing/renderProps.ts`, `shared/editing/renderProps.test.ts`
- Modify: `shared/types.ts` (`CaptionTemplate.colors.emphasis`), `shared/captions/templates.ts`, `shared/captions/segment.ts` + `segment.test.ts`, `shared/remotion/activeWord.ts` + `activeWord.test.ts`, `shared/remotion/CaptionVideo.tsx`, `backend/modules/pipeline/pipeline.ts`, `tests/integration/render.test.ts`

**Interfaces:**
- Consumes: `applyCuts`, `keptSegments`, `Segment` (Task 2).
- Produces:
  - Template emphasis colours — clean `{ keyword: "#FF9F0A", noun: "#64D2FF", pictorial: "#30D158" }`, bold `{ keyword: "#FFD60A", noun: "#64D2FF", pictorial: "#FF6B9A" }`, karaoke `{ keyword: "#FFD60A", noun: "#64D2FF", pictorial: "#30D158" }`.
  - `activeWord.ts`: `wordColor(template: CaptionTemplate, word: Word, isActive: boolean): string` (karaoke active → `activeWord`, else emphasis colour, else `text`); `segmentFrames(segments: Segment[], fps: number): { trimBefore: number; durationInFrames: number }[]` (`trimBefore` = `round(startMs·fps/1000)` in source frames; boundaries from cumulative output ms with `round`, the last one with `ceil`, so the frames sum to exactly the `Math.ceil(durationMs·fps/1000)` that `Root.calculateMetadata` and `CaptionPreview` use — otherwise the final frame falls outside the `<Series>`; zero-length dropped).
  - `CaptionVideoProps.segments?: Segment[]` — when present the source plays as a `<Series>` of `<Series.Sequence durationInFrames trimBefore>` (`trimBefore` on the Sequence shifts the child's frame; works for `OffthreadVideo`, `Video` and `Audio` alike). Captions keep reading the top-level `useCurrentFrame()`, i.e. output time — which is why `applyCuts` remaps them. `phrase.emoji` renders in a row above the caption block at `1.2 × fontSize`; the row is always laid out (empty when no emoji) so the caption block does not jump between phrases.
  - `segment.ts`: `carryEmoji(prev: Phrase[], next: Phrase[]): Phrase[]` (each emoji moves to the new phrase containing the old phrase's first word id).
  - `renderProps.ts`: `DIMS` (moved from pipeline.ts/CaptionPreview.tsx); `enabledCuts(project: Project): Cut[]`; `captionVideoProps(project: Project, opts: { videoSrc: string; sourceDurationMs: number }): CaptionVideoProps` (burn-in translation if present else `phrases`, cuts applied — words dropped only for the original track — `segments` + shortened `durationMs` only when a cut is enabled); `subtitleTracks(project: Project): { language: TranslationLanguage | null; phrases: Phrase[] }[]` (original first, then each translation, cut-applied the same way).
  - `pipeline.ts`: `renderOutputs(deps: AppDeps, project: Project, source: Asset, report: (p: number, stage?: string) => void): Promise<Project["outputs"]>` — stages `render` (70) and `subtitles` (95); files `${jobKey}.mp4`, `${jobKey}.srt|vtt`, `${jobKey}.${lang}.srt|vtt`. `startCaptionJob` uses it; with `transcribe` it also clears `editPlan`, `translations`, `burnInLanguage`; a resegment without transcribe applies `carryEmoji`.

- [ ] **Step 1: Failing tests**

```ts
// activeWord.test.ts
it("wordColor: active beats emphasis beats text", () => { /* clean template: active → #FFD60A, {emphasis:"noun"} → #64D2FF, plain → #FFFFFF */ });
it("segmentFrames rounds on the cumulative timeline and ends on the composition's last frame", () => {
  expect(segmentFrames([{ startMs: 0, endMs: 1010 }, { startMs: 2000, endMs: 3010 }], 30))
    .toEqual([{ trimBefore: 0, durationInFrames: 30 }, { trimBefore: 60, durationInFrames: 31 }]); // 30.3 → 30; total 60.6 → ceil 61
  expect(segmentFrames([{ startMs: 0, endMs: 2010 }], 30)).toEqual([{ trimBefore: 0, durationInFrames: 61 }]); // round would give 60
});
// segment.test.ts
it("carryEmoji follows the old phrase's first word", () => { /* resegmented with a narrower layout; emoji lands on the phrase holding that word id */ });
// renderProps.test.ts
it("without enabled cuts plays the whole source", () => { /* segments undefined, durationMs === 21000, phrases === project.phrases */ });
it("enabled cuts shorten the timeline and shift captions", () => {
  // editPlan.cuts [{startMs:1000,endMs:3000,shouldTrim:true}]; durationMs 19000; segments [{0,1000},{3000,21000}]; a word at 5000 → 3000
});
it("burn-in language swaps in the translated track", …);
it("subtitles follow enabled cuts", () => {
  // tracks[0].language null with the filler word dropped; tracks[1] (es) keeps all its words; both shifted by the cut
});
```
- [ ] **Step 2: Run `npx vitest run shared` — FAIL.**
- [ ] **Step 3: Implement**; extend `tests/integration/render.test.ts` with a second case rendering `segments: [{0,800},{1200,2000}]` (`durationMs: 1600`) and an emphasised word + emoji.
- [ ] **Step 4: `npm run verify` — PASS (the 13 existing pipeline tests unchanged); `npm run render:sample` — 2 passed.**
- [ ] **Step 5: Commit** `feat(render): emphasis colours, emoji, cut timeline, burn-in and translated subtitle tracks`

### Task 6: Plan API and job

**Files:**
- Create: `backend/modules/editplan/routes.ts`, `backend/modules/editplan/routes.test.ts`, `backend/shared/apiTestHelpers.ts`
- Modify: `backend/app/app.ts`, `backend/modules/pipeline/pipeline.test.ts` (import `projectWithSource`/`untilStatus` from the helpers)

**Interfaces:**
- Consumes: `planEdit`, `translatePhrases` (Task 4); `detectCuts` (Task 2); `renderOutputs`, `startCaptionJob` (Task 5).
- Produces: `editPlanRouter(deps: AppDeps): Router`; `startPlanJob(deps: AppDeps, project: Project, input: PlanInput): JobState` (job kind `"plan"`; status `planning` → stage `plan` (10) → `translate` (40 + 30·done/total per batch, only with languages; targets equal to `project.language` skipped) → save `editPlan`, `phrases` (with emphasis/emoji), `translations`, `burnInLanguage` → status `rendering` → `renderOutputs` → `ready`; an error before the save restores the previous status, saves nothing and rethrows; a render error sets `failed` (plan data kept, so a later PATCH can re-render). Cuts come from `detectCuts(project.transcript.words, source.durationMs ?? 0)` — ASR words, not edited phrases, and the same duration `renderOutputs` uses.
  - `POST /api/projects/:id/plan` `PlanInput` → `202 {jobId}`; `400 invalid_input`; `404 not_found`; `400 no_captions` (no transcript or no phrases); `409 busy`.
  - `GET /api/projects/:id/plan` → `200 EditPlan`; `404 no_plan`.
  - `PATCH /api/projects/:id/plan` `UpdatePlanInput` → `400 unknown_id` (any cut/shot id not in the plan, nothing saved); `400 bad_burn_in` (language without a translation); `409 busy`; saves; if a `shouldTrim` or the burn-in changed → `startCaptionJob(…, { transcribe: false, resegment: false })` and `202 {jobId}`, else `200 EditPlan`.
- `apiTestHelpers.ts`: `projectWithSource(deps)`, `untilStatus(app, id, status)`, `readyProject(deps)` (source + `/run` + ready); `untilPlanned` (ready **and** `editPlan` set) stays local to `routes.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
it("plans, translates and re-renders", async () => {
  const deps = makeTestDeps(); const { a, project } = await readyProject(deps);
  expect((await request(a).post(`/api/projects/${project.id}/plan`).send({ languages: ["es"], burnInLanguage: "es" })).status).toBe(202);
  const done = await untilPlanned(a, project.id); // status ready && editPlan
  expect(done.editPlan!.cuts).toContainEqual(expect.objectContaining({ reason: "pause", startMs: 17950, endMs: 21000 }));
  expect(done.editPlan!.shots[0]).toMatchObject({ kind: "Hook", startMs: 0 });
  expect(done.phrases[0].emoji).toBe("🔥");
  expect(done.burnInLanguage).toBe("es");
  const es = done.outputs.translations!.find((t) => t.language === "es")!;
  expect((await request(a).get(`/api/assets/${es.srtAssetId}/file`)).text).toContain("Spanish: ");
  expect((deps.renderer as FakeRenderer).calls.at(-1)!.durationMs).toBe(17950);
  expect((await request(a).get(`/api/projects/${project.id}/plan`)).body).toEqual(done.editPlan);
});
it("plan failure keeps previous outputs", async () => {
  // llm: new FakeLlm(() => { throw new Error("llm_unavailable"); }); collect bus job events
  // → a FAILED job event with error "llm_unavailable"; project status "ready", same mp4AssetId, editPlan null
});
it("rejects plan without captions", …);          // source only → 400 no_captions; GET /plan → 404 no_plan
it("toggling a cut re-renders at full length", …); // PATCH {cuts:[{id:<trailing pause>, shouldTrim:false}]} → 202, last render durationMs 21000
it("changing only a shot kind saves without rendering", …); // 200, kind changed, renderer.calls length unchanged
it("unknown ids and untranslated burn-in are rejected", …); // 400 unknown_id, 400 bad_burn_in, plan unchanged
it("template change keeps plan data; re-run clears it", …); // PUT template → emphasis/emoji/translations kept; POST /run → editPlan null, translations [], burnInLanguage null
```
- [ ] **Step 2: Run `npx vitest run backend/modules/editplan` — FAIL.**
- [ ] **Step 3: Implement**; register `editPlanRouter` in `app.ts`.
- [ ] **Step 4: `npm run verify` — PASS.**
- [ ] **Step 5: Commit** `feat(editplan): plan job and API (POST/GET/PATCH /plan)`

### Task 7: Edit plan panel (mobile-first)

**Files:**
- Create: `frontend/src/features/projects/components/EditPlanPanel.tsx`, `frontend/src/features/projects/components/EditPlanPanel.test.ts`
- Modify: `frontend/src/features/projects/api/projects.ts`, `frontend/src/features/projects/components/ProjectPage.tsx`, `CaptionPreview.tsx`, `StageProgress.tsx`, `frontend/src/features/projects/hooks/projectEvents.ts` + `projectEvents.test.ts`

**Interfaces:**
- Consumes: `api.projectPlan`, `PlanInput`, `UpdatePlanInput`, `LANGUAGE_NAMES`, `SHOT_KINDS` (Task 1); `captionVideoProps`, `enabledCuts`, `DIMS` (Task 5); `mapTime` (Task 2).
- Produces:
  - `planProject(id, input: PlanInput)`, `updatePlan(id, input: UpdatePlanInput)` in `projects.ts`.
  - `shotLayout(shots: Shot[], durationMs: number): { id: string; leftPct: number; widthPct: number }[]`; `planChanges(project: Project, draft: { trim: Record<string, boolean>; kinds: Record<string, ShotKind>; burnIn?: TranslationLanguage | null }): UpdatePlanInput | null` (compares against `project.editPlan` / `project.burnInLanguage`; only entries that differ; `null` when nothing does).
  - `EditPlanPanel({ project, busy, onPlan, onUpdate, onSeek })`: without a plan → up to 3 language chips (source language hidden), burn-in select (None + chosen), "Plan edit" button; with a plan → scrubber (44 px bar, one tappable block per shot coloured by kind — Hook amber, Talking Head neutral, B-Roll sky, Talking Head & B-Roll violet — with red ticks at enabled cuts; tap = select + `onSeek(shot.startMs)`), kind `<select>` for the selected shot, legend, cut list (checkbox rows "Pause 1.2 s at 0:03.4" / "Filler “um” at 0:07.1", ≥ 44 px), burn-in select over existing translations, "Apply" (enabled when `planChanges` ≠ null) and "Re-plan".
  - `CaptionPreview` builds props with `captionVideoProps` and takes `playerRef: RefObject<PlayerRef | null>`; `ProjectPage` seeks with `Math.round(mapTime(ms, enabledCuts(p)) * FPS / 1000)`, uses `p.sourceDurationMs ?? <old estimate>`, lists translation SRT/VTT downloads (`${title}.${lang}.srt`).
  - `EventsState` gains `kind: string | null`; `StageProgress({ kind, stage, progress })` with plan stages `plan → translate → render → subtitles` ("Planning", "Translating", "Rendering", "Subtitles").

- [ ] **Step 1: Failing tests**

```ts
it("shotLayout maps ms to percentages", () => {
  expect(shotLayout([shot("a", 0, 5000), shot("b", 5000, 20000)], 20000)).toEqual([{ id: "a", leftPct: 0, widthPct: 25 }, { id: "b", leftPct: 25, widthPct: 75 }]);
});
it("planChanges returns only real differences", () => {
  expect(planChanges(project, { trim: { "cut-0": true }, kinds: {} })).toBeNull();          // same as saved
  expect(planChanges(project, { trim: { "cut-0": false }, kinds: { "shot-1": "B-Roll" } }))
    .toEqual({ cuts: [{ id: "cut-0", shouldTrim: false }], shots: [{ id: "shot-1", kind: "B-Roll" }] });
});
// projectEvents.test.ts
it("tracks the job kind", () => { /* PROCESSING plan job → state.kind === "plan" */ });
```
- [ ] **Step 2: Run `npx vitest run frontend` — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run verify` — PASS; browser check** with `FAKE_AI=1 npm run dev:lite` + `npm run dev`: upload `~/Desktop/Reverse Engineer/test-clip-9x16.mp4` (via the API with curl if the pane cannot pick files) → Generate captions → Plan edit (es, burn-in) → scrubber + cuts render at 375 px wide with no horizontal scroll; tap a shot seeks; untick a cut → Apply → re-render → Spanish SRT downloads; Ollama-down run (no `FAKE_AI`) shows `llm_unavailable` and keeps downloads.
- [ ] **Step 5: Commit** `feat(web): edit plan panel with shot scrubber, cut toggles and translations`

---

## Finish

- [ ] One fresh review pass over the whole branch (`git diff main…`), fix Critical/Important findings with tests.
- [ ] `PROJECT.md` State + Run (Ollama: `brew install ollama` → `npm run ai:ollama` → `ollama pull qwen2.5:3b`; never the menu-bar app; `OLLAMA_MODEL=qwen2.5:7b` for better translations; `FAKE_AI=1`; schema columns unapplied until `make db && npm run dev:server`); README plan table row 2 ✅; test count.
- [ ] `npm run verify` green; commit `docs: plan 2 complete`; file this plan as a note in `/Users/febrielotud/Obsidian/Astro/Claude Code/` with `[[wiki-links]]` (global rule).
