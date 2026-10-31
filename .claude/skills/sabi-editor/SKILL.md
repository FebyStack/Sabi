---
name: sabi-editor
description: Edit a Sabi video project through the sabi MCP tools — inspect, apply typed actions, verify with a rendered frame, re-render, export. Use when the user asks to edit captions, cuts, shots, templates, translations, B-roll, motion graphics, the brand kit or exports of a Sabi project.
---

# Sabi editor

The `sabi` MCP server is a thin client of the running Sabi API. No model runs inside it: you are the editor, on the user's Claude subscription.

The web editor is open beside you more often than not: the user sees your edits live (changed blocks pulse, "Edited by the agent") and may be dragging on the timeline at the same time. Both of you write through the same actions path with a `baseVersion`; a `stale` answer means they edited first — re-inspect, never retry blindly. The web app no longer renders on edit: after `apply_actions`, the outputs are **stale** until `run_job {kind: "render", scale?: 2}`, and `export_outputs` refuses stale outputs.

## The loop

1. `list_projects` → pick the id (or `create_project {title, path}` → `run_job captions` → `wait_job`).
2. `inspect_project {projectId}` → the summary. Keep its `baseVersion`.
3. Specifics only when needed: `inspect_project {section: "phrases", offset, limit}` or `{search: "<regex>"}` (word times), `{section: "plan"}` (every cut and shot), `{section: "broll"}` (beats, overlays, motion graphics, brand kit).
   Once a plan exists, `run_job {kind: "broll"}` → `wait_job` fills every `B-Roll` / `Talking Head & B-Roll` shot with stock (Pexels) or generated (fal.ai) media, by the project's media source. It needs `PEXELS_KEY` or `FAL_KEY` on the API.
4. `apply_actions {projectId, baseVersion, actions: [...]}` — batch every edit of the turn into one call, `render: false` while iterating. Each result gives the new `baseVersion`; use it next time.
5. `render_frame {projectId, timestampMs}` at the edited moment to check it. Frames are **output** time: when cuts are on, use the `→ out` / `(out …)` time inspect prints, not the source time.
6. Happy → `run_job {kind: "render"}` once (`scale: 2` = 4K; or `apply_actions` with `render: true`) → `wait_job`. Until then the summary's `outputs:` line ends with `(stale)`.
7. `export_outputs {projectId, outDir}` (an existing folder under the user's home that iCloud does not sync; default to `~/Movies/Sabi`, `mkdir -p` it first).

Actions: `setTitle {title}`, `editPhrase {phraseId, text}` (timings kept; a different word count is spread over the phrase), `setCut {cutId, shouldTrim}`, `setShotKind {shotId, kind}`, `setTemplate {captionTemplateId: clean|bold|karaoke}`, `setBurnIn {language|null}` (only a language already translated). Max 50 per call; one bad id rejects the whole batch; actions apply in order, each seeing the ones before it.

Timing and caption detail (source ms):
- `setShotBounds {shotId, startMs?, endMs?}` — shots stay contiguous: moving an edge moves the neighbour's matching edge; every shot keeps ≥ 500 ms; the first start and the last end never move (`400 out_of_range`).
- `retimePhraseRange {phraseId, startMs, endMs}` — the phrase's words are scaled into the new span; ≥ 200 ms, and it may not overlap its neighbours (`400 overlap`).
- `setWordEmphasis {phraseId, wordId, emphasis: noun|keyword|pictorial|null}` · `setPhraseEmoji {phraseId, emoji|null}` (≤ 16 chars).
- `setCaptionStyle {style: {fontFamily?, sizePx? 40–120, y? 0.5–0.9, uppercase?, weight? 400|700|900, background?, animation? karaoke|none} | null}` — the whole style on top of the template and brand kit; absent keys keep the template's value; the summary prints it as `caption style {…}`.
- Fonts (`setCaptionStyle.fontFamily`, `setBrand.fontFamily`) are the bundled set only: `Inter`, `Montserrat`, `Poppins`, `Bebas Neue`, `Playfair Display`, `Space Grotesk` — the Player and the render load the same files.

Layer actions (source time, like everything inspect prints):
- `setMediaSource {mediaSource: generate|stock}` — where the next `run_job broll` gets media (stock = Pexels only, never fal).
- `setOverlay {overlayId, enabled?, startMs?, endMs?, placement?: full|top, transition?: fade|none}` — the range must stay inside its shot (`400 out_of_shot`).
- `removeOverlay {overlayId}` · `replaceOverlay {overlayId, assetId}` — an image or video asset from `upload_asset`.
- `setBrand {brand: {palette: {primary, accent, text, background}, fontFamily, logoAssetId?, grade?} | null}` — the whole kit at once; `null` = template colours, no grade.
- `addMotionGraphic {name, code, startMs, endMs, box?, props?}` · `updateMotionGraphic {mgId, …any of those, enabled?}` · `removeMotionGraphic {mgId}` — read `motion-graphics.md` in this skill folder before writing one.

## B-roll

- Overlays are drawn only over shots whose kind is `B-Roll` (full frame) or `Talking Head & B-Roll` (top band, above the captions). Flip a shot with `setShotKind`; inspect marks the overlays of other shots `stale`, and the next `run_job broll` replaces them.
- Toggle or retime: `setOverlay`. Another pick for one overlay: `run_job {kind: "broll", overlayId, query?}` (stock: next results page; generate: a new fal image). Redo all: `run_job {kind: "broll", regenerate: true}`.
- The user's own picture or clip: `upload_asset {projectId, path}` → `replaceOverlay {overlayId, assetId}`.
- Stock overlays carry a Pexels attribution; keep it (the panel shows "Photo: <author> / Pexels").

## Brand kit

- `setBrand` colours the captions (text, accent = active word + keywords, primary = nouns and pictorial words), every motion graphic (`item.brand`) and grades the footage and B-roll (`grade` 0–1, default 0.4; 0 = none). Hex colours `#RRGGBB`; `fontFamily` is one of the bundled fonts above. Keep caption text readable on the background (≥ 3:1 contrast; the Style panel warns below that).
- A logo: `upload_asset` the PNG → `setBrand {brand: {…, logoAssetId}}`; motion graphics read it as `item.brand.logoUrl`.
- Check with one `render_frame` on a caption and one on B-roll before `run_job render`.

## Motion graphics

Agent-written Remotion components drawn between the B-roll and the captions. Read `motion-graphics.md` (contract, craft rules, example) first. One representative MG, verified and approved by the user, before any batch; at most 2 `render_frame` per MG.

## Budget

- Summary first; never page through every phrase "just to look". Search instead.
- At most 4 `render_frame` calls per turn (each is an image in context).
- `run_job plan` recomputes cuts and shots (manual toggles are lost) and needs local Ollama: run it before fine edits, not after.
- `run_job broll` in generate mode spends fal.ai credits (≈ $0.01 an image, $0.25 the one video beat); the summary's `credits` line shows the total. Prefer stock while exploring.

## When something fails

- `project changed since baseVersion … re-run inspect_project` — the user (web UI, maybe mid-drag) or another session edited first. Re-inspect, re-apply on the new state; never retry blindly.
- `outputs are stale; run_job render first` (export_outputs) — an edit landed after the last render; `run_job {kind: "render"}` → `wait_job`, then export.
- `refused: … syncs to iCloud` (export_outputs) — Desktop, Documents and iCloud Drive can evict the files off the Mac; export to `~/Movies/Sabi` instead.
- `busy: <kind> job …` — a job is running. `wait_job`, then re-inspect.
- `Sabi API not reachable …` — tell the user to start the API: `FAKE_AI=1 npm run dev:lite` (launch config `api-lite-fake`) or `npm run dev:lite`.
- `400 no_captions` — `run_job captions` first. `400 unknown_id` — the id came from a stale view; re-inspect.
- `400 bad_code {detail}` — the motion-graphic code broke a rule in `motion-graphics.md`; fix what `detail` names. `400 bad_asset` — the asset is missing or the wrong kind (logos and image props need an image). `400 out_of_range` — an MG must end inside the source, a shot edge broke the 500 ms / fixed-ends rule, or a phrase got shorter than 200 ms. `400 overlap` — a phrase range ran into its neighbour.
- `wait_job` → `broll FAILED: stock_unavailable` / `generator_unavailable` — the key for the project's media source is not set on the API; switch with `setMediaSource` or ask the user to set it. Warnings `broll_not_found:beat-n` / `no_broll_shots` mean a beat got no media / there is no B-roll shot.

## Tagalog & Taglish

- **Force the language** when `inspect_project` says `en` but the phrases read like Tagalog (`ng`, `mga`, `ang`, `hindi`), or the user says the clip is Taglish: `run_job {kind: "captions", language: "tl"}` → `wait_job`. It re-transcribes, so the plan, translations and B-roll go (motion graphics and the brand kit stay); do it before any fine edits. Later runs keep `tl`.
- **`timing_estimated` warning:** part of the clip could not be aligned, so those words got timings spread over their segment. Karaoke highlights can drift there; check those spots with `render_frame`.
- **Fillers:** `ano / kasi / parang / ganun / eh` are cut automatically only when pauses isolate them, never when they end a sentence or open one with just a comma after them; everything else is your call. Keep "Ano?" (a question), "Ano ang…", a "kasi" that explains, and a sentence-final "ganun." that is the answer. `'yung` is never cut automatically: cut a stalling `'yung` yourself, but keep the one right before its noun ("Kinuha ko 'yung libro"). `kuwan` / `kwan` (a stand-in for a forgotten word) is usually worth cutting together with the stall around it. `inspect_project {section: "plan"}` lists every cut; toggle with `setCut`.
- **Common whisperX errors, fixed with `editPhrase`:** `ng` ↔ `nang`; `'yung` written `young` / `yong`; `din`/`rin` and `daw`/`raw` swapped; `po`/`ho` dropped; hyphenated affixes split (`mag aaral` → `mag-aaral`); English loanwords respelled (`kompyuter` vs `computer`: keep what the speaker said); proper names lower-cased.
- **Phrasing:** keep the code-switching as spoken. Never translate Taglish into pure Tagalog or pure English, and never drop `po`; fix spelling and punctuation only.
- **Captions:** line breaks already keep `ng / sa / ang / mga` with their noun, and emphasis never lands on particles. A stranded particle in a frame comes from an `editPhrase` that changed the word count (its timings are spread): re-check that phrase's text.

## Examples

**Fix a misspelling** ("it says 'mourning', should be 'morning'"):
`inspect_project {search: "mourning"}` → `"mourning" ph-0 w-5 0:01.2–0:01.6` →
`apply_actions {actions: [{type: "editPhrase", phraseId: "ph-0", text: "<the phrase with morning>"}]}` (send the whole phrase text from `section: "phrases"`) →
`render_frame {timestampMs: 1400}` → `run_job render` → `wait_job`.

**Remove the pause at 0:05**:
`inspect_project {section: "plan"}` → find the `pause` cut spanning 0:05, e.g. `cut-3 pause 0:05.2–0:05.9 (off)` →
`apply_actions {actions: [{type: "setCut", cutId: "cut-3", shouldTrim: true}], render: true}` → `wait_job`.
No plan yet → `run_job plan` first (cuts start on).

**Bold template + Spanish burn-in**:
Summary shows `translations es`? → `apply_actions {actions: [{type: "setTemplate", captionTemplateId: "bold"}, {type: "setBurnIn", language: "es"}]}` →
`render_frame` once → `run_job render` → `wait_job`.
No `es` yet → `run_job {kind: "plan", languages: ["es"], burnInLanguage: "es"}` → `wait_job`, then `setTemplate` as above.
