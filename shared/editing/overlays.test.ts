import type { Cut, MotionGraphic, Overlay, Project, Shot } from "../types";
import { motionGraphicTimeline, overlayTimeline, staleOverlays } from "./overlays";

const url = (id: string) => `http://api/assets/${id}`;
const shots: Shot[] = [
  { id: "shot-0", kind: "Hook", startMs: 0, endMs: 4000 },
  { id: "shot-1", kind: "B-Roll", startMs: 4000, endMs: 12000 },
  { id: "shot-2", kind: "Talking Head & B-Roll", startMs: 12000, endMs: 21000 },
];
const ov = (id: string, startMs: number, endMs: number, extra: Partial<Overlay> = {}): Overlay => ({
  id, shotId: "shot-1", assetId: `a-${id}`, media: "image", source: "stock", startMs, endMs, placement: "full", transition: "fade", enabled: true, query: "", prompt: "", intent: "", ...extra,
});
const cut = (startMs: number, endMs: number, shouldTrim = true): Cut => ({ id: `cut-${startMs}`, startMs, endMs, reason: "pause", text: "", shouldTrim });
const on = (cs: Cut[]) => cs.filter((c) => c.shouldTrim);

describe("overlayTimeline", () => {
  it("overlays follow enabled cuts", () => {
    const o = ov("ov-0", 4300, 9300);
    expect(overlayTimeline([o], shots, on([cut(5000, 6000)]), url)).toEqual([
      { id: "ov-0", src: "http://api/assets/a-ov-0", media: "image", startMs: 4300, endMs: 8300, placement: "full", transition: "fade" },
    ]);
    expect(overlayTimeline([o], shots, on([cut(4000, 10000)]), url)).toEqual([]);
    expect(overlayTimeline([o], shots, on([cut(5000, 6000, false)]), url)[0]).toMatchObject({ startMs: 4300, endMs: 9300 });
  });

  it("drops disabled overlays", () => {
    expect(overlayTimeline([ov("ov-0", 4300, 9300, { enabled: false })], shots, [], url)).toEqual([]);
  });

  it("clips to a minimum of 500 ms", () => {
    expect(overlayTimeline([ov("ov-0", 4300, 9300)], shots, [cut(4700, 9300)], url)).toEqual([]); // 400 ms left
    expect(overlayTimeline([ov("ov-0", 4300, 9300)], shots, [cut(4800, 9300)], url)[0]).toMatchObject({ startMs: 4300, endMs: 4800 });
  });

  it("sorted by start", () => {
    const out = overlayTimeline([ov("ov-1", 12300, 17300, { shotId: "shot-2", media: "video", durationMs: 4000 }), ov("ov-0", 4300, 9300)], shots, [], url);
    expect(out.map((o) => o.id)).toEqual(["ov-0", "ov-1"]);
    expect(out[1]).toMatchObject({ media: "video", durationMs: 4000 });
  });

  it("overlays of unknown or non-b-roll shots are not drawn", () => {
    const overlays = [ov("ov-0", 4300, 9300), ov("ov-1", 300, 2300, { shotId: "shot-0" }), ov("ov-2", 300, 2300, { shotId: "shot-9" })];
    expect(overlayTimeline(overlays, shots, [], url).map((o) => o.id)).toEqual(["ov-0"]);
    expect(staleOverlays({ overlays, editPlan: { cuts: [], shots } } as unknown as Project)).toEqual(["ov-1", "ov-2"]);
    expect(staleOverlays({ overlays, editPlan: null } as unknown as Project)).toEqual(["ov-0", "ov-1", "ov-2"]);
  });
});

describe("motionGraphicTimeline", () => {
  it("motion graphics resolve image props to urls", () => {
    const mg: MotionGraphic = {
      id: "mg-0", name: "Logo", code: "", compiled: "c", startMs: 4300, endMs: 9300, box: { x: 0, y: 0, w: 1, h: 0.5 }, enabled: true,
      props: [{ key: "logo", type: "image", value: "img-1" }, { key: "title", type: "text", value: "Hi" }, { key: "n", type: "number", value: 3 }],
    };
    expect(motionGraphicTimeline([mg, { ...mg, id: "mg-1", enabled: false }], [cut(5000, 6000)], url)).toEqual([
      { id: "mg-0", compiled: "c", startMs: 4300, endMs: 8300, box: { x: 0, y: 0, w: 1, h: 0.5 }, props: { logo: "http://api/assets/img-1", title: "Hi", n: 3 } },
    ]);
  });
});
