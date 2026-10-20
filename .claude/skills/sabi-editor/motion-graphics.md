# Motion graphics in Sabi

A motion graphic (MG) is a small Remotion component you write. Sabi draws it inside the same `CaptionVideo` composition as everything else, so `render_frame`, the browser preview and the MP4 show the same pixels. Order, back to front: footage → B-roll overlays → brand tint → **motion graphics** → captions. The brand grade never touches an MG.

## Contract

- `code` is plain JavaScript with JSX: no TypeScript annotations, no `import`/`export`, at most 20 000 characters. It must declare a top-level `const Component`.
- The server transpiles and vets it (never runs it). Rejected with `400 bad_code` and a `detail`:
  - network, storage and global names: `window document globalThis self top parent frames opener open location navigator fetch XMLHttpRequest WebSocket EventSource Image Audio Worker SharedWorker BroadcastChannel importScripts postMessage localStorage sessionStorage indexedDB`;
  - code from strings and reflection: `eval Function constructor __proto__ Reflect Proxy require process`, timers `setTimeout setInterval setImmediate queueMicrotask`, `with`, dynamic `import()`;
  - HTML from strings: `dangerouslySetInnerHTML innerHTML outerHTML insertAdjacentHTML srcDoc`, `{...spread}` JSX attributes, `<script> <iframe> <object> <embed> <frame> <link> <meta> <base> <form>`, `javascript:` URLs, property names built from strings (`x["a" + "b"]`).
- These rules apply to *references*: property names (`style={{ top: 0 }}`, `item.props.open`) and names you declare yourself (`const { parent } = item.props`) are fine.
- In scope, and nothing else: `React, AbsoluteFill, Img, Easing, interpolate, interpolateColors, random, spring, useCurrentFrame, useVideoConfig`.
- Your component receives `{ item }`:
  - `item.props` — your declared props as `{ key: value }` (image props arrive as URLs);
  - `item.brand` — `{ primary, accent, text, background, fontFamily, logoUrl, grade }`, the kit or the caption template's colours when there is none;
  - `item.width`, `item.height` — the box in pixels; `item.durationInFrames` — the MG's own length (30 fps).
  `useCurrentFrame()` counts from the MG's start.
- Skeleton:
  ```jsx
  const Component = ({ item }) => {
    const frame = useCurrentFrame();
    const props = item.props;
    return <div style={{ position: "absolute", inset: 0 }}>{props.title}</div>;
  };
  ```
- `props` (max 20): `{ key, type: "text"|"number"|"color"|"boolean"|"image", value }`, keys `camelCase`. Make every visible text, number and colour a prop so it can be changed with `updateMotionGraphic {props}` without touching code. `image` values are asset ids from `upload_asset`. `<Img>` sources come only from image props and `item.brand.logoUrl`.
- `box` = `{x, y, w, h}` as fractions of the frame (default the whole frame). `startMs`/`endMs` are **source** time and must end inside the source.
- A runtime error never breaks the frame: the box shows a red `⚠ mg-<n>` label instead. An endless loop fails the render after about 40 s.

## Craft rules

1. **Know the job before coding.** Name what the viewer should get (a number, a list, a name, a contrast), the exact words, the settled frame, the speech span it sits on and how long it needs to be read. `render_frame` the target moment first to see the subject and the captions.
2. **The brand kit is the visual language.** Colours and font only from `item.brand`; one coherent system across a video. Each MG's form comes from its job, not from the previous MG.
3. **Use a mechanism, not just text.** A mark, a bar, a mask reveal, a stagger, the logo, a tiny diagram. Text rarely stands alone. Avoid the card-in-the-middle, purple/blue gradients, glass, glow and shine unless the job means them. Prefer asymmetry and negative space to centred boxes.
4. **Settled frame first, then motion.** Design the frame the viewer reads, then animate into it. Motion finishes inside the MG's duration; the leading element moves first; use `spring` and `Easing` rather than linear ramps.
5. **Layout that survives edits.** Flex or grid, wrapping text, headroom for longer prop text and for scaled states. Draw compound shapes in one `<svg>`.
6. **Respect the captions and the shot.** Keep `y + h ≤ 0.72` while captions run (`inspect_project {section: "broll"}` flags `⚠ overlaps captions`). A full-frame MG is a deliberate beat: usually over a `B-Roll` shot with that shot's overlay set `enabled: false`. Typical length 2–6 s, inside one shot and outside enabled cuts (`section: "plan"`).
7. **Verify, then judge the settled frame.** `render_frame` once mid-animation and once at the settled frame (output time: use the `→ out` times when cuts are on). Fix placement with `box`, timing with `startMs`/`endMs`, looks with `code` or `props` (`updateMotionGraphic`). A red `⚠ mg-<n>` means the code threw: check the props you read and how you use `item`.
8. **One first, then the batch.** Make one representative MG, place it, verify it, show the user. Only after they approve, make the rest. A batch shares the kit, not the form.

## Example — a stat callout

```json
{"type": "addMotionGraphic", "name": "Stat: 2 hours", "startMs": 4300, "endMs": 8300,
 "box": {"x": 0.06, "y": 0.1, "w": 0.6, "h": 0.3},
 "props": [{"key": "value", "type": "number", "value": 2}, {"key": "unit", "type": "text", "value": "hours"},
           {"key": "label", "type": "text", "value": "of meditation? No."}],
 "code": "const Component = ({ item }) => {\n  const frame = useCurrentFrame();\n  const { fps } = useVideoConfig();\n  const { value, unit, label } = item.props;\n  const b = item.brand;\n  const rise = spring({ frame, fps, config: { damping: 18 } });\n  const n = Math.round(interpolate(frame, [0, 20], [0, value], { extrapolateRight: \"clamp\" }));\n  const bar = interpolate(frame, [8, 26], [0, 1], { extrapolateLeft: \"clamp\", extrapolateRight: \"clamp\", easing: Easing.out(Easing.cubic) });\n  const out = interpolate(frame, [item.durationInFrames - 10, item.durationInFrames], [1, 0], { extrapolateLeft: \"clamp\" });\n  return (\n    <div style={{ position: \"absolute\", inset: 0, display: \"flex\", flexDirection: \"column\", justifyContent: \"center\", gap: 12, fontFamily: `${b.fontFamily}, system-ui, sans-serif`, color: b.text, opacity: out, transform: `translateY(${(1 - rise) * 40}px)` }}>\n      <div style={{ fontSize: item.height * 0.42, fontWeight: 900, lineHeight: 1 }}>{n} <span style={{ fontSize: item.height * 0.18, color: b.accent }}>{unit}</span></div>\n      <div style={{ height: 10, width: `${bar * 70}%`, background: b.accent, borderRadius: 5 }} />\n      <div style={{ fontSize: item.height * 0.12, fontWeight: 700 }}>{label}</div>\n    </div>\n  );\n};"}
```

Send it in `apply_actions` (with the current `baseVersion`), then `render_frame` at about 0:04.6 (mid-animation) and 0:05.5 (settled).
