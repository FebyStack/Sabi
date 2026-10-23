# Plan 6 — MG Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every agent-written motion graphic runs in its own network-less sandboxed iframe, in the Player, `/frame` and the MP4 alike. The agent learns why an MG broke, the web edits MG props, and the editor page gets a strict CSP.

**Architecture:**
- A committed, generated sandbox page (`frontend/public/mg-sandbox.html`, CSP `default-src 'none'`) carries React and the MG runtime.
- `MotionGraphicLayer` embeds one per MG with `sandbox="allow-scripts"`, hands it fonts and images as Blobs, and drives it frame by frame over `postMessage`.
- Renders wait per frame with `delayRender`. A 15 s / 5 s watchdog draws ⚠.
- Problems travel `console.warn` → Remotion `onBrowserLog` → header `x-sabi-mg-problems` → `render_frame`.
- The editor gets a Vite-injected CSP. Both pages lock `frame-src` to `'self'`.

**Tech Stack:** React 19.2, Remotion 4.0.536 (bundler, renderer, player), Vite 7, esbuild 0.25 (devDependency), Express 5, zod, vitest 3 (node environment).

**Spec:** `docs/superpowers/specs/2026-10-23-mg-sandbox-design.md` and `docs/spec.md` rows 24–27. Read both before starting.

## Global Constraints

- **Owner rules:**
  - The spec is approved; ask nothing new mid-plan.
  - One whole-branch review at the end.
  - Commits carry no `Co-Authored-By` or "Generated with" lines.
  - Never plain `npm install` (use `npm run deps`). No `cd` in compound shell commands.
  - Subscription only: no Anthropic API anywhere.
- **Dependencies:** no new npm dependency. esbuild stays a devDependency; only the build script and its test import it.
- **Sandbox page CSP, exactly:** `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; base-uri 'none'; form-action 'none'`
- **iframe:** `sandbox="allow-scripts"` exactly; `src = staticFile("mg-sandbox.html")`.
- **Watchdog:** `MG_START_MS = 15_000` (until `ready`), `MG_FRAME_MS = 5_000` (per `drawn`).
- **Problems:**
  - kinds `threw | image | blocked | navigated | silent`
  - log prefix `sabi:mg `
  - header `x-sabi-mg-problems`: ≤ 10 entries, `detail` ≤ 200 chars, printable ASCII only
- **Frame lock:** `frame-src 'self'` on the render page and in the editor. The editor CSP never has `'unsafe-eval'`, and its `script-src` is `'self'` plus hashes only.
- **Preview = export:** nothing about an MG may differ between the Player and the render page, except whether the page waits for it.
- **Remotion location:** run Remotion only from a checkout whose `node_modules` is the deps symlink. Elsewhere it downloads a 570 MB Chrome into `<cwd>/node_modules/.remotion`. `npm run render:sample` sets `TMPDIR=~/Developer/.sabi-tmp` itself.
- **No DB migration.**

## Review Focus

1. **The sandbox page never answers** (a 404 because a Docker image lacks `frontend/public`, a runtime crash) → ⚠ after 15 s and the render finishes; never a hung or failed render. Pinned in Task 2 (start timeout) and Task 5 (renderer `publicDir`).
2. **An image prop whose file can't be fetched or decoded** (deleted asset, wrong type) → `⚠ image`, an `image` problem, and the render finishes. Task 5 render test.
3. **Problem text that is non-ASCII or huge** (a Tagalog/emoji message, a 5 KB URL) → a valid ASCII header of ≤ 10 entries × ≤ 200 chars; Express never throws `ERR_INVALID_CHAR`. Task 1 test.
4. **Garbage or spoofed messages from inside a sandbox** (unknown `t`, a string `seq`, a `drawn` for another seq, a 1 MB `detail`) → ignored or cut; never settles the wrong frame. Tasks 1 and 2.
5. **Two MGs in range on the same frame of a 4K export** (`scale: 2`) → both drawn, export finishes. Task 5 render test.

---

### Task 1: MG problem contract and sandbox protocol

**Files:**
- Modify: `shared/contract.ts`, `shared/types.ts`, `shared/editing/overlays.ts`
- Create: `shared/remotion/mgProtocol.ts`
- Test: `shared/remotion/mgProtocol.test.ts` (new), `shared/editing/overlays.test.ts`

**Interfaces — Produces:**
- `shared/contract.ts`:
  - `MG_PROBLEMS_HEADER = "x-sabi-mg-problems"`
  - `MgProblemSchema = z.object({ mg: z.string().max(40), kind: z.enum(["threw", "image", "blocked", "navigated", "silent"]), detail: z.string().max(200) })`
- `shared/types.ts`: `type MgProblem = z.infer<typeof MgProblemSchema>`.
- `MotionGraphicProps` gains `images: string[]`: the URLs of its `image` props, in prop order, from `motionGraphicTimeline`.
- `shared/remotion/mgProtocol.ts`:
  - `MG_START_MS`, `MG_FRAME_MS`, `MG_LOG_PREFIX = "sabi:mg "`
  - `type MgItem = { props: Record<string, string | number | boolean>; brand: BrandLook; width: number; height: number; durationInFrames: number }` (moved here from `mgRuntime.ts`)
  - `type FontPayload = { css: string; files: Blob[] }`
  - `type ToSandbox = { t: "init"; id: string; compiled: string; fps: number; width: number; height: number; fonts: FontPayload; images: [string, Blob][] } | { t: "draw"; seq: number; frame: number | null; item: MgItem }`
  - `type FromSandbox = { t: "ready" } | { t: "drawn"; seq: number } | { t: "problem"; kind: "threw" | "image" | "blocked"; detail: string }`
  - `parseFromSandbox(data: unknown): FromSandbox | null`
  - `mgLogLine(p: MgProblem): string`, `parseMgLog(text: string): MgProblem | null`
  - `logMgProblem(p: MgProblem): void`: `console.warn` once per page per line
  - `mgProblemsHeader(ps: MgProblem[]): string`

- [ ] **Step 0: Set up the checkout.** `npm run deps` (creates the `node_modules` symlink to `~/Developer/.sabi-deps/unruffled-lehmann-2630ef`), then `npm run verify` → green before any change.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/remotion/mgProtocol.test.ts
it("accepts only the three sandbox messages and cuts details to 200 chars", () => {
  expect(parseFromSandbox({ t: "ready" })).toEqual({ t: "ready" });
  expect(parseFromSandbox({ t: "drawn", seq: 3 })).toEqual({ t: "drawn", seq: 3 });
  expect(parseFromSandbox({ t: "problem", kind: "blocked", detail: "x".repeat(1_000_000) }))
    .toEqual({ t: "problem", kind: "blocked", detail: "x".repeat(200) });
  for (const bad of [null, "ready", { t: "drawn", seq: "3" }, { t: "drawn", seq: 1.5 }, { t: "init" },
    { t: "problem", kind: "navigated", detail: "" }, { t: "problem", kind: "threw" }]) expect(parseFromSandbox(bad)).toBeNull();
});
it("problem log lines round-trip; anything else is not a problem", () => {
  const p = { mg: "mg-0", kind: "threw", detail: "TypeError: x is undefined" } as const;
  expect(mgLogLine(p)).toBe('sabi:mg {"mg":"mg-0","kind":"threw","detail":"TypeError: x is undefined"}');
  expect(parseMgLog(mgLogLine(p))).toEqual(p);
  for (const t of ["hello", "sabi:mg {", 'sabi:mg {"mg":"mg-0","kind":"exploded","detail":""}']) expect(parseMgLog(t)).toBeNull();
});
it("logs each problem once per page", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const p = { mg: "mg-9", kind: "silent", detail: "no answer for 5 s" } as const;
  logMgProblem(p); logMgProblem(p);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(mgLogLine(p));
});
it("the problems header is printable ASCII, ≤ 10 entries of ≤ 200 chars, and parses back", () => {
  const ps = Array.from({ length: 12 }, (_, i) => ({ mg: `mg-${i}`, kind: "threw" as const, detail: `Hindi ma-load ang larawan 🖼️ ${"é".repeat(300)}` }));
  const h = mgProblemsHeader(ps);
  expect(/^[\x20-\x7e]*$/.test(h)).toBe(true);
  const back = z.array(MgProblemSchema).parse(JSON.parse(h));
  expect(back).toHaveLength(10);
  expect(back[0].detail.startsWith("Hindi ma-load ang larawan 🖼️")).toBe(true);
});
```

Add to `overlays.test.ts`: `motionGraphicTimeline lists its image props' URLs`. Props `[{ key: "photo", type: "image", value: "a1" }, { key: "title", type: "text", value: "x" }, { key: "badge", type: "image", value: "a2" }]` with `assetUrl = (id) => "/f/" + id` → `images` equals `["/f/a1", "/f/a2"]`, and `props.photo === "/f/a1"` as before.

- [ ] **Step 2: Run** `npx vitest run shared/remotion/mgProtocol.test.ts shared/editing/overlays.test.ts` → FAIL (module missing / `images` undefined).

- [ ] **Step 3: Implement.**
  - The header escapes each char above U+007E as `\uXXXX` after `JSON.stringify` of `ps.slice(0, 10)`, with each `detail` cut to 200 (`JSON.stringify` already escapes control chars).
  - The log dedupe is a module-level `Set` of lines.
  - `parseMgLog` = prefix check + `JSON.parse` in try + `MgProblemSchema.safeParse`.

- [ ] **Step 4: Run** the same command → PASS. Then `npm run typecheck && npm run typecheck:server` → no errors. Update the `MotionGraphicProps` literals in existing tests to add `images: []`.

- [ ] **Step 5: Commit** `feat(mg): problem contract and sandbox protocol types; MG render props list their image URLs`

---

### Task 2: `MgChannel` — handshake and watchdog

**Files:** Modify `shared/remotion/mgProtocol.ts`; Test `shared/remotion/mgProtocol.test.ts`.

**Interfaces — Consumes:** Task 1 types. **Produces:**

```ts
export class MgChannel {
  constructor(post: (m: ToSandbox) => void, onSilent: (detail: string) => void);
  readonly ready: Promise<void>;            // settles on "ready", or when the channel dies
  get dead(): boolean;
  receive(m: FromSandbox): void;            // handles "ready" and "drawn"; "problem" is the caller's
  draw(frame: number | null, item: MgItem): Promise<void>;
  kill(): void;                              // dead without onSilent; settles everything; posts nothing more
}
```

`draw` waits for `ready`, then posts `{ t: "draw", seq, frame, item }` (`seq` counts from 1). It settles on that seq's `drawn`. Without one, after `MG_FRAME_MS` it calls `onSilent("no answer for 5 s")` and dies. When dead it settles at once without posting. The constructor arms the start timer: no `ready` within `MG_START_MS` → `onSilent("did not start in 15 s")`, dead.

- [ ] **Step 1: Write the failing tests** (`vi.useFakeTimers()`; `item` any `MgItem`):
  - `draws only after ready and settles on its own answer`:
    - before `ready`, a `draw(7, item)` posts nothing
    - after `receive({ t: "ready" })` it posts `{ t: "draw", seq: 1, frame: 7, item }`
    - `receive({ t: "drawn", seq: 2 })` leaves it pending
    - `receive({ t: "drawn", seq: 1 })` settles it
  - `a sandbox that never starts dies after 15 s`: at 14 999 ms not dead; at 15 000 ms `onSilent` was called with `"did not start in 15 s"`, `dead` is true, the pending draw settled, nothing was posted.
  - `an unanswered frame kills the channel after 5 s`: after ready, `draw(0, item)`, advance 5000 → `onSilent("no answer for 5 s")`, dead; the next `draw` settles at once and posts nothing.
  - `kill settles pending draws without onSilent`.

- [ ] **Step 2: Run** `npx vitest run shared/remotion/mgProtocol.test.ts` → FAIL.
- [ ] **Step 3: Implement `MgChannel`** (timers via `setTimeout`; pending draws in a `Map<number, () => void>`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(mg): host channel with a 15 s start and 5 s frame watchdog`

---

### Task 3: The sandbox page

**Files:**
- Modify: `shared/remotion/mgRuntime.ts`, `shared/remotion/mgRuntime.test.ts`, `package.json`
- Create: `shared/remotion/sandbox/entry.tsx`, `infrastructure/dev/build-mg-sandbox.ts`, `frontend/public/mg-sandbox.html` (generated), `backend/modules/mg/sandbox.test.ts`

**Interfaces — Consumes:** `MgItem`, `ToSandbox`, `FromSandbox` (type-only imports, so zod stays out of the sandbox bundle). **Produces:**
- `mgRuntime.ts` (sandbox side only from now on):
  - `type MgConfig = { id: "CaptionVideo"; width: number; height: number; fps: number; durationInFrames: number }`
  - `MG_SCOPE`: same 10 names. `useCurrentFrame` and `useVideoConfig` read an `MgCtx` context. `Img` is a plain `<img>` that maps a known URL to its blob, tracks `load` → `decode()`, and on error draws the existing `⚠ image` box and reports `image`.
  - `buildMotionGraphic(compiled: string, onError?: (message: string) => void): Mg`
  - `withBlobUrls(item: MgItem, blobs: Map<string, string>): MgItem`
  - `MgView(p: { mg: Mg; id: string; frame: number | null; item: MgItem; config: MgConfig; report: (kind: "threw" | "image", detail: string) => void; track: (load: Promise<unknown>) => void }): ReactElement | null`
  - `MgPlaceholder`, `MgBroken` unchanged
- `infrastructure/dev/build-mg-sandbox.ts`:
  - `SANDBOX_CSP` (the exact string from Global Constraints)
  - `buildMgSandboxHtml(): Promise<string>`
  - run as a script, it writes `frontend/public/mg-sandbox.html`
- npm script `"build:mg-sandbox": "tsx infrastructure/dev/build-mg-sandbox.ts"`

- [ ] **Step 1: Write the failing tests** (`shared/remotion/mgRuntime.test.ts`, rewritten around `MgView`):
  - `draws the component at the given frame`:
    - code: ``const Component = ({ item }) => React.createElement("div", null, item.props.title, " ", useCurrentFrame(), " ", useVideoConfig().fps);``
    - `renderToStaticMarkup(<MgView mg={buildMotionGraphic(code)} id="mg-0" frame={12} item={item} config={{ id: "CaptionVideo", width: 1080, height: 1920, fps: 30, durationInFrames: 60 }} report={() => {}} track={() => {}} />)`
    - expected: `'<div style="position:absolute;inset:0;overflow:hidden"><div>42% faster 12 30</div></div>'`
  - `frame null draws nothing` → `""`.
  - `useVideoConfig is the frame and the MG's length, nothing more`: a component rendering `JSON.stringify(useVideoConfig())` gives `{"id":"CaptionVideo","width":1080,"height":1920,"fps":30,"durationInFrames":60}`.
  - `evaluation errors report threw`:
    - `buildMotionGraphic("throw new Error('x')", onError)` is `MgBroken` and `onError` got `"x"`
    - `buildMotionGraphic("const Component = 42;", onError)` → `onError("no Component")`
    - `MgView` with `MgBroken` contains `⚠ mg-0`
  - `image props and the logo become blob URLs`: `withBlobUrls` maps a prop equal to a known URL and `brand.logoUrl`, and leaves unknown URLs and non-URL props alone.
  - Keep the existing ones:
    - `MG_SCOPE.Img` is not Remotion's
    - caches by source
    - sees only its scope; also assert `Object.keys(MG_SCOPE)` equals the 10 names in order

  New `backend/modules/mg/sandbox.test.ts` (60 s timeout):
  - `the committed sandbox page is the current build`: `expect(readFileSync("frontend/public/mg-sandbox.html", "utf8") === await buildMgSandboxHtml(), "stale: run npm run build:mg-sandbox").toBe(true)`.
  - `the page denies all network before its only script`:
    - `content="${SANDBOX_CSP}"` appears before `<script>`
    - exactly one `<script>`, with no `src=`
    - `<html lang="en">`

- [ ] **Step 2: Run** `npx vitest run shared/remotion/mgRuntime.test.ts backend/modules/mg/sandbox.test.ts` → FAIL.

- [ ] **Step 3: Implement `mgRuntime.ts` changes** (see Interfaces). `MgView` = root `div` (`position:absolute;inset:0;overflow:hidden`) → `MgCtx.Provider` → an error boundary (`componentDidCatch` → `report("threw", error.message)`, renders `MgPlaceholder`) → `<Mg item={item} />`.

- [ ] **Step 4: Implement `shared/remotion/sandbox/entry.tsx`:**
  - Startup:
    - `const host = window.parent` (captured once); post with `host.postMessage(m, "*")`
    - a `securitypolicyviolation` listener posts `{ t: "problem", kind: "blocked", detail: `${e.effectiveDirective} ${e.blockedURI}` }`
    - one React root on a `div` appended to `body`
    - messages are accepted only when `e.source === host`
  - On the first `init`:
    1. Inject a `<style>` with `fonts.css`, every `__sabi_font_<i>__` replaced by `URL.createObjectURL(fonts.files[i])`.
    2. Map each image URL to a blob URL and `await img.decode()` each (errors ignored).
    3. `buildMotionGraphic(compiled, (m) => post threw m)`, keep `id`/config, post `{ t: "ready" }`.
  - On `draw`:
    1. `flushSync` render `MgView` with `withBlobUrls(item, blobs)`.
    2. `void document.body.offsetHeight` (forces layout, so needed fonts start loading).
    3. `await Promise.allSettled(pending)`, then `await document.fonts.ready`.
    4. Post `{ t: "drawn", seq }`.

- [ ] **Step 5: Implement `build-mg-sandbox.ts`.**
  - esbuild options: entry `shared/remotion/sandbox/entry.tsx`, `bundle`, `format: "iife"`, `minify`, `legalComments: "none"`, `define: { "process.env.NODE_ENV": '"production"' }`, `jsx: "automatic"`, `write: false`.
  - Replace `</script` with `<\/script` in the output.
  - HTML, exactly: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><style>html,body{margin:0;background:transparent}</style></head><body><script>${js}</script></body></html>\n`
  - Then run `npm run build:mg-sandbox`; expect ≈ 480 KB.

- [ ] **Step 6: Run** the Step 2 command → PASS; `npm run typecheck && npm run typecheck:server` → clean.
- [ ] **Step 7: Commit** `feat(mg): sandbox page (React + MG runtime, CSP default-src 'none'), built by npm run build:mg-sandbox`

---

### Task 4: Fonts and images for the sandbox (parent side)

**Files:** Create `shared/remotion/mgAssets.ts`; Test `shared/remotion/mgAssets.test.ts`.

**Interfaces — Consumes:** `FontPayload` (Task 1), `BRAND_FONTS`, `fontCssFamily`. **Produces:**
- `fontFaceCss(rules: { css: string; base: string }[], families: string[]): { css: string; urls: string[] }`: keeps the `@font-face` rules whose `font-family` (quotes stripped) is in `families`, rewrites each `url(...)` to `url(__sabi_font_<i>__)` and returns `urls[i] = new URL(raw, base).href`.
- `fontPayload(): Promise<FontPayload>`: once per page. Reads every same-origin stylesheet's rules (a sheet that throws on `cssRules` is skipped), runs `fontFaceCss` with `BRAND_FONTS.map(fontCssFamily)`, and fetches each URL as a Blob.
- `imageBlobs(urls: string[]): Promise<{ blobs: [string, Blob][]; failed: string[] }>`: each URL fetched once per page; a non-OK response or rejection goes in `failed`.

- [ ] **Step 1: Write the failing tests:**
  - `fontFaceCss keeps the bundled families' faces with indexed URLs`, with three rules:
    1. `@font-face { font-family: "Inter Variable"; font-style: normal; font-weight: 100 900; src: url("./files/inter-latin-wght-normal.woff2") format("woff2-variations"); unicode-range: U+0000-00FF; }` with base `http://localhost:5173/node_modules/@fontsource-variable/inter/index.css`
    2. `@font-face { font-family: Other; src: url(x.woff2); }`
    3. `.x { color: red }`

    Expectations:
    - `css` contains `url(__sabi_font_0__) format("woff2-variations")` and `unicode-range: U+0000-00FF`
    - `css` doesn't contain `Other` or `.x`
    - `urls` equals `["http://localhost:5173/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"]`
  - `imageBlobs fetches each URL once and lists failures`, with `vi.stubGlobal("fetch", …)` answering 200 for `/a`, 404 for `/b`, rejecting `/c`:
    - result: `blobs` has `/a` only; `failed` is `["/b", "/c"]`
    - a second call with `["/a"]` doesn't fetch again

- [ ] **Step 2: Run** `npx vitest run shared/remotion/mgAssets.test.ts` → FAIL.
- [ ] **Step 3: Implement** (module-level caches: one promise for the fonts payload, a `Map` of promises per image URL).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(mg): the page hands fonts and image props to the sandbox as Blobs`

---

### Task 5: The host — one sandboxed iframe per MG

**Files:**
- Modify: `shared/remotion/MotionGraphicLayer.tsx`, `shared/remotion/MotionGraphicLayer.test.ts`, `shared/remotion/index.ts`, `backend/shared/renderer.ts`, `backend/shared/renderer.test.ts`, `infrastructure/docker/Dockerfile`, `tests/integration/render.test.ts`

**Interfaces — Consumes:** Tasks 1–4 (`MotionGraphicProps.images`, `parseFromSandbox`, `logMgProblem`, `MgChannel`, `fontPayload`, `imageBlobs`, the sandbox page). **Produces:**
- `mgWindow(mg: MotionGraphicProps, fps: number, frame: number): { from: number; durationInFrames: number; local: number; active: boolean }`
- `sandboxKey(mg: MotionGraphicProps, brand: BrandLook): string` = `[mg.compiled, ...mg.images, brand.logoUrl ?? ""].join("\n")`
- `RemotionRenderer` option `publicDir?: string`, default `resolve("frontend/public")`, passed to `bundle()`

- [ ] **Step 0: Baseline.** `npm run render:sample -- --reporter=verbose`: note the suite time and each MG test's time for the PR. Check ports 3001/5173 are free (`lsof -i :3001 -i :5173`).

- [ ] **Step 1: Write the failing unit tests.** Mock `remotion` the way the current test does: `useCurrentFrame`, `useVideoConfig` → `{ fps: 30, width: 1080, height: 1920 }`, `getRemotionEnvironment` → `{ isRendering: false }`; keep `staticFile` real.
  - `mgWindow` with `startMs 1000, endMs 2000` at 30 fps:
    - frame 29 → `{ active: false, local: -1 }`
    - frame 30 → active, local 0
    - frame 59 → active, local 29
    - frame 60 → inactive
    - `endMs: 1010` → `durationInFrames 0`
  - `sandboxKey` changes with `compiled`, an image URL or `logoUrl`; stays equal when a text prop or a brand colour changes.
  - `MotionGraphicLayer` markup at frame 45, box `{ x: 0, y: 0, w: 1, h: 0.2 }`, contains:
    - `sandbox="allow-scripts"`
    - `src="/mg-sandbox.html"`
    - `title="mg-0"`
    - `aria-hidden="true"`
    - `tabindex="-1"`
    - styles `left:0px`, `top:0px`, `width:1080px`, `height:384px`, `pointer-events:none`, `color-scheme:normal`, `visibility:visible`

    At frame 100 → `visibility:hidden`. A zero-length MG → `""`.
  - `renderer.test.ts` `bundles with frontend/public as the public folder`: `vi.mock("@remotion/bundler")` and `vi.mock("@remotion/renderer")` (stub `openBrowser`); `await new RemotionRenderer({ entry: "x.ts", bundleDir }).warm()` → `bundle` was called with `expect.objectContaining({ publicDir: resolve("frontend/public") })`.

- [ ] **Step 2: Run** `npx vitest run shared/remotion/MotionGraphicLayer.test.ts backend/shared/renderer.test.ts` → FAIL.

- [ ] **Step 3: Implement the host in `MotionGraphicLayer.tsx`.** `MotionGraphicLayer` computes `mgWindow`, returns `null` for zero length, and renders the inner host keyed by `sandboxKey`. The host:
  - **iframe:** `src = staticFile("mg-sandbox.html")`, `sandbox="allow-scripts"`, `title = mg.id`, `aria-hidden`, `tabIndex = -1`. Style: absolute box in px, `border: 0`, `pointerEvents: "none"`, `colorScheme: "normal"`, `visibility` from `active`.
  - **Setup in `useLayoutEffect`** (StrictMode mounts twice in dev):
    - creates the `MgChannel`
    - in renders (`getRemotionEnvironment().isRendering`), one `delayRender("mg <id> start")` released when `channel.ready` settles
    - a `window` `message` listener: `e.source === iframe.contentWindow` → `parseFromSandbox` → a `problem` goes to `logMgProblem({ mg: id, … })`, the rest to `channel.receive`
    - cleanup: `kill()` and release every handle
  - **`onLoad`:**
    - First load: `Promise.all([fontPayload(), imageBlobs([...mg.images, brand.logoUrl].filter(Boolean))])`, log an `image` problem per failed URL, then post `init`.
    - Any later load: `logMgProblem({ mg, kind: "navigated", detail: "tried to leave its frame" })`, then `kill()` and mark dead.
  - **`onSilent`:** log `silent` with its detail and mark dead.
  - **Per frame** (`useLayoutEffect` on `active`, `local`, `JSON.stringify(item)`, `dead`):
    - in range: `channel.draw(local, item)`, wrapped in `delayRender` / `continueRender` in renders
    - on leaving the range: one `channel.draw(null, item)` without waiting
  - **Dead:** no iframe; while in range, a box `div` with the existing `MgPlaceholder`.
  - `<Sequence>` goes.

- [ ] **Step 4: Frame lock and packaging.**
  - `shared/remotion/index.ts` prepends `<meta http-equiv="Content-Security-Policy" content="frame-src 'self'">` to `document.head` before `registerRoot`.
  - `RemotionRenderer` gains `publicDir`.
  - `Dockerfile` api stage adds `COPY frontend/public ./frontend/public` next to `COPY shared ./shared`.

- [ ] **Step 5: Run** the Step 2 command → PASS.

- [ ] **Step 6: Write the gated render tests** in `tests/integration/render.test.ts`.

  Setup:
  - The test server answers `/red.png` with `access-control-allow-origin: *` (the page fetches image props).
  - A second `canary` server records every request URL.
  - Add helper `pixelAt(file, frame, x, y)`: `select=eq(n\,<frame>)` + `crop=2:2`.
  - Compiled code in these tests is written directly, skipping the vetter.

  Tests:
  - `MG frames are exact`: `React.createElement("div", { style: { position: "absolute", inset: 0, background: \`rgb(${useCurrentFrame() * 4},0,0)\` } })` over 0–2000 ms; at frames 0/15/30/45, red is within ±6 of `frame * 4`.
  - `an MG cannot reach the network or the page`:
    - The code tries the canary via `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, `new Image`, a CSS `background-image: url()` and a nested `<iframe src>`, each in `try`. It also tries `window.parent.document.body.style.background = "red"` in `try`.
    - Then it draws a green box at `{ x: 0, y: 0, w: 1, h: 0.2 }`.
    - Expect: canary hits `[]` (after the render + 1 s), the box pixel green, a pixel at y 1500 not red.
  - `an MG that navigates draws ⚠ and reaches nothing`: `location.href = "<canary>/nav"` in render → canary `[]`; red ⚠ pixel at the box's top-left (6, 6); the render finishes.
  - `an image prop is drawn from bytes`: props `{ photo: "<base>/red.png" }`, `images: ["<base>/red.png"]`, `React.createElement(Img, { src: item.props.photo, style: full })` → red pixel.
  - `an image prop that doesn't decode draws ⚠ image`: `images: ["<base>/missing.png"]` (served as MP4) → red `⚠ image` pixel; the render finishes.
  - `a silent MG becomes ⚠ in 5 s and the render finishes`: `addEventListener("message", (e) => e.stopImmediatePropagation(), true)` inside the component → the frame at 0.9 s shows the red ⚠ at (6, 6); `Date.now()` delta < 60 s.
  - `two MGs on one frame of a 4K export`: top box green, bottom box `{ y: 0.8, h: 0.2 }` blue, `scale: 2` → both colours at 2× coordinates.
  - `the /frame still equals the MP4 frame`: the frame-colour MG; `renderStill` at 1000 ms vs MP4 frame 30 at one point → within ±6.
  - `an MG gets the brand fonts`: draws text in `"Bebas Neue"` and colours its box green when `[...document.fonts].some((f) => f.family === "Bebas Neue" && f.status === "loaded")`, else red → at 0.5 s the box is green.

  The existing four MG tests (brand, throws, missing `<Img>` URL, endless loop) stay as they are.

- [ ] **Step 7: Run** `npm run render:sample -- --reporter=verbose` → all pass. Compare times with Step 0; the overhead must stay ≤ +20 % on the MG tests, otherwise stop and report.
- [ ] **Step 8: Run** `npm run verify` → green.
- [ ] **Step 9: Commit** `feat(mg): every motion graphic runs in its own sandboxed iframe in the Player, /frame and the MP4; the render page locks frames`

---

### Task 6: Problem report to the agent

**Files:** Modify `backend/shared/renderer.ts`, `backend/modules/frames/routes.ts`, `backend/modules/frames/routes.test.ts`, `backend/mcp/client.ts`, `backend/mcp/tools.ts`, `backend/mcp/tools.test.ts`, `tests/integration/render.test.ts`.

**Interfaces — Consumes:** `MG_PROBLEMS_HEADER`, `MgProblemSchema`, `parseMgLog`, `mgProblemsHeader`. **Produces:**
- `type StillResult = { mgProblems: MgProblem[] }`
- `Renderer.renderStill(req: StillRequest): Promise<StillResult>`
- `FakeRenderer.stillProblems: MgProblem[] = []` (returned by its `renderStill`)
- `SabiApi.frame(id, t, w)` → `{ data: Buffer; ms: number; problems: MgProblem[] }` (a missing or invalid header → `[]`)

`render_frame` appends one line per problem after `frame at … (output timeline)`, exactly:

| kind | line |
|---|---|
| threw | `⚠ ${mg} threw: ${detail} — fix the code; it draws its ⚠ label` |
| image | `⚠ ${mg} image failed: ${detail} — use an image prop (upload_asset) or item.brand.logoUrl` |
| blocked | `${mg} was refused ${detail} — MGs have no network; images come only from image props or item.brand.logoUrl` |
| navigated | `⚠ ${mg} tried to navigate — MGs can't leave their frame; it draws ⚠` |
| silent | `⚠ ${mg} stopped answering (${detail}) — look for a loop that never ends; it draws ⚠` |

- [ ] **Step 1: Write the failing tests:**
  - `routes.test.ts` `sends the still's MG problems in a header`: `stillProblems = [{ mg: "mg-0", kind: "threw", detail: "Hindi gumana 🙃" }]` → `JSON.parse(res.headers["x-sabi-mg-problems"])` equals it; with none the header is absent.
  - `tools.test.ts` `render_frame lists each MG problem with a hint`: one problem of each kind → `res.text` equals `frame at 0:01.0 (output timeline)` + `\n` + the five lines.
  - `render.test.ts` (gated) `renderStill returns the MG problems`:
    - `mg-0` throws `boom`; `mg-1` renders `<img src="https://example.invalid/x.png">` (blocked by CSP before any DNS lookup)
    - `mgProblems` contains `{ mg: "mg-0", kind: "threw", detail: "boom" }`
    - `mgProblems` contains a `blocked` entry for `mg-1` whose detail starts with `img-src https://example.invalid/x.png`

- [ ] **Step 2: Run** `npx vitest run backend/modules/frames/routes.test.ts backend/mcp/tools.test.ts` → FAIL.
- [ ] **Step 3: Implement:**
  - `RemotionRenderer.renderStill` passes `onBrowserLog: (log) => { const p = parseMgLog(log.text); if (p) problems.push(p); }` (deduped by line) and returns `{ mgProblems }`.
  - The frames route sets the header only when there are problems.
  - Then the client and the tool.
- [ ] **Step 4: Run** the Step 2 command and `npm run render:sample` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): render_frame reports why each MG broke or what it was refused`

---

### Task 7: Strict editor CSP

**Files:** Create `frontend/src/csp.ts`, `frontend/src/csp.test.ts`; Modify `vite.config.ts`, `infrastructure/docker/nginx.conf`.

**Interfaces — Produces:**
- `inlineScripts(html: string): string[]`: the bodies of `<script>` tags without a `src`
- `editorCsp(o: { dev: boolean; scriptHashes: string[]; posthogHost?: string }): string`
- `withCspMeta(html: string, policy: string): string`: the meta becomes the first child of `<head>`

- [ ] **Step 1: Write the failing tests** (`frontend/src/csp.test.ts`):
  - `the build policy`: `editorCsp({ dev: false, scriptHashes: [] })` equals exactly `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'`.
  - `dev adds the preamble's hash, websockets and the PostHog origin`, with `{ dev: true, scriptHashes: ["'sha256-abc='"], posthogHost: "https://eu.i.posthog.com/some/path" }`:
    - contains `script-src 'self' 'sha256-abc='`
    - contains `connect-src 'self' ws: wss: https://eu.i.posthog.com`
  - `never eval or inline script`: both policies contain no `'unsafe-eval'`, and their `script-src` has no `'unsafe-inline'`.
  - `inlineScripts` on `<script type="module">import a</script><script type="module" src="/x.js"></script>` → `["import a"]`.
  - `withCspMeta` on `<html><head><title>S</title></head>` → `<head>` immediately followed by `<meta http-equiv="Content-Security-Policy" content="…">`.

- [ ] **Step 2: Run** `npx vitest run frontend/src/csp.test.ts` → FAIL.
- [ ] **Step 3: Implement `csp.ts`.**
- [ ] **Step 4: Wire it in `vite.config.ts`** with a plugin `sabi-csp`:
  - `configResolved(c)` keeps `c.env`.
  - `transformIndexHtml: { order: "post", handler: (html, ctx) => withCspMeta(html, editorCsp({ dev: !!ctx.server, scriptHashes: inlineScripts(html).map(sha256), posthogHost: env.VITE_POSTHOG_HOST })) }`, where `sha256 = (s) => \`'sha256-${createHash("sha256").update(s).digest("base64")}'\``.
  - `configureServer` and `configurePreviewServer` add middleware that sets `Content-Security-Policy: frame-ancestors 'self'` on every response except `/mg-sandbox.html`.

  In `nginx.conf`, `location /` gets `add_header Content-Security-Policy "frame-ancestors 'self'" always;`, and a `location = /mg-sandbox.html {}` serves the sandbox page without it.
- [ ] **Step 5: Run** `npx vitest run frontend/src/csp.test.ts` → PASS. Then `npm run build` → `dist/index.html` starts its `<head>` with the meta, with no `sha256-`.
- [ ] **Step 6: Commit** `feat(web): strict CSP on the editor (no eval, own origin only, frame-ancestors 'self')`

---

### Task 8: The web edits MG props

**Files:** Create `frontend/src/features/editor/panels/MgPropsSheet.tsx`, `MgPropsSheet.test.tsx`; Modify `BrollPanel.tsx`, `BrollPanel.test.tsx`.

**Interfaces — Consumes:** `updateMotionGraphic` (existing action), `useDebouncedCommit`, `uploadFile`, `assetFileUrl`, `Sheet`, `Field`, `Switch`, `Notice`. **Produces:**
- `propLabel(key: string): string`: `"unitLabel"` → `"Unit label"`, `"value"` → `"Value"`
- `MgPropsSheet(p: { mg: MotionGraphic; projectId: string; busy: boolean; commit: (actions: Action[]) => Promise<void>; onClose: () => void })`

Fields, one per prop, labelled by `propLabel`:

| type | field |
|---|---|
| text | `<input>`, `maxLength={500}` |
| number | `<input type="number">` |
| color | `<input type="color">`, value lowercased |
| boolean | `Switch` |
| image | `<img src={assetFileUrl(id)}>` + Replace file input, `accept="image/png,image/jpeg,image/webp"` |

Commits:
- Every commit is `[{ type: "updateMotionGraphic", mgId, props: <whole array with the new value> }]`.
- text, number and colour are debounced 300 ms; the rest commit at once.
- A draft holds the latest values (reset when `mg.props` changes).
- An upload or commit error shows a `Notice`.

BrollPanel: MG rows with props get an **Edit** button (`aria-haspopup="dialog"`, `aria-label="Edit ${m.name}"`). It opens the sheet for that `mgId`, which reads the current MG from `project.motionGraphics` on every render.

- [ ] **Step 1: Write the failing tests.** Record element props through the `react/jsx-dev-runtime` mock, as `StylePanel.test.tsx` does.
  - `propLabel` cases above.
  - `one labelled field per prop` (text, number, color `#FFD60A`, boolean, image `a-1`):
    - html has `value="#ffd60a"` and `maxLength="500"`
    - html has `src="/api/assets/a-1/file"` (or whatever `assetFileUrl` returns)
    - html has `accept="image/png,image/jpeg,image/webp"`
  - `a text edit commits the whole props array after 300 ms` (fake timers): call the text input's `onChange` with `{ target: { value: "of sleep" } }` → no commit at 299 ms; at 300 ms `commit` was called with `[{ type: "updateMotionGraphic", mgId: "mg-0", props: [ …, { key: "label", type: "text", value: "of sleep" }, … ] }]`.
  - `a switch commits at once`.
  - `an uploaded image commits its asset id`: `vi.mock("@/features/projects/api/projects")` with `uploadFile` resolving `{ id: "a-9" }` → `commit` gets the image prop with value `"a-9"`. A rejecting `uploadFile` → `commit` not called.
  - BrollPanel: `Edit` appears only for MGs with props.

- [ ] **Step 2: Run** `npx vitest run frontend/src/features/editor/panels/MgPropsSheet.test.tsx frontend/src/features/editor/panels/BrollPanel.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `MgPropsSheet.tsx` and the BrollPanel button and state.
- [ ] **Step 4: Run** → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(web): edit motion-graphic props in the B-roll panel`

---

### Task 9: Docs, manual checks, timing

**Files:** Modify `.claude/skills/sabi-editor/motion-graphics.md`, `.claude/skills/sabi-editor/SKILL.md`, `backend/modules/mg/compile.ts` (comment only), `PROJECT.md`, `docs/superpowers/plans/README.md`.

- [ ] **Step 1: Update `motion-graphics.md`'s Contract** with the six points of design §8:
  - runs sandboxed
  - images only from image props / logo, else blocked and reported
  - `useVideoConfig()` fields
  - unstyled text is serif in preview and export: always set `fontFamily`
  - `render_frame` problem lines
  - 5 s silent → ⚠; an endless loop still fails the render after ~40 s

  The denylist bullets stay, introduced as "early warnings (the sandbox is the boundary)". The example must still pass `the sabi-editor skill's example passes the vetting`.
- [ ] **Step 2: Update `SKILL.md`'s errors section:** `render_frame` may list MG problems; fix what each line names.
- [ ] **Step 3: Update `compile.ts`'s header comment:** an early warning for the agent; the sandbox page is the boundary.
- [ ] **Step 4: Update `PROJECT.md`:**
  - Decisions: the MG decision now names the sandbox; drop the "open decision".
  - Run/verify:
    - `npm run build:mg-sandbox` after changing `shared/remotion/sandbox/`, `mgRuntime.ts` or React/Remotion versions (the freshness test fails otherwise)
    - restart the API to rebundle
    - the editor CSP (PostHog origin from `VITE_POSTHOG_HOST`)
  - State: plan 6 summary, review outcome, deferred minors.
- [ ] **Step 5: Update the plans README:** row `6 ✅ | 2026-10-23-mg-sandbox.md | …`.
- [ ] **Step 6: Run** `npm run verify` and `npm run render:sample` → green.
- [ ] **Step 7: Manual check** in the browser pane: `api-lite-fake` + `dev` launch entries, ports checked first.
  1. On the demo, the stat MG in the Player at 0:04.6 and 0:05.5 matches `GET /api/projects/<id>/frame?t=4600` / `5500`.
  2. `document.querySelector('meta[http-equiv="Content-Security-Policy"]').content` is the dev policy, and the console has no CSP violations from the editor.
  3. At 375 px with touch emulation: B-roll → the MG's **Edit** → change the label → the Player shows it within ~1 s → change the colour → upload a PNG for an image prop on a test MG.
  4. `curl -sI "localhost:3001/api/projects/<id>/frame?t=500"` on a project with a throwing MG shows `x-sabi-mg-problems`.

  Record results and the Task 5 timing in `PROJECT.md`.
- [ ] **Step 8: Commit** `docs: plan 6 done (MG sandbox): skill contract, PROJECT.md, plans README`

---

### Finish

- [ ] **Whole-branch review (one pass):** a fresh reviewer gets `git diff origin/claude/agent-and-ops...HEAD`, the spec and this plan's Review Focus. Fix every Critical and Important finding with a test, then re-run `npm run verify` and `npm run render:sample`.
- [ ] **PR:** push the branch and open a PR to `main` saying "merge #6 and #7 first". The body has no Generated-with line and covers: the spec rows, rulings, timing, manual checks, deferred minors.
- [ ] **File** the execution note in Obsidian (`Claude Code/Captions Clone Plan 6 Execution.md`, linking [[Captions AI Rebuild Blueprint]], [[Captions Clone Plan 5 Execution]] and the plan note). Leave a hand-over note in the shared session notes folder.
