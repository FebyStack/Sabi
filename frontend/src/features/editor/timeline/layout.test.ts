import { editorProject } from "@shared/editing/fixtures";
import { blockLabel, blocks, blockWidthPx, dragBounds, dragToActions, msToPx, pxToMs, snap, snapPoints, type Block } from "./layout";

const p = editorProject();
const all = blocks(p);
const block = (id: string) => all.find((b) => b.id === id)!;

describe("timeline layout", () => {
  it("blocks lists every track with labels, handles and muted state", () => {
    expect(all.map((b) => `${b.track}:${b.id}`)).toEqual([
      "shots:shot-0", "shots:shot-1", "shots:shot-2", "cuts:cut-0", "cuts:cut-1", "captions:ph-0", "captions:ph-1", "captions:ph-2", "broll:ov-0", "mg:mg-0",
    ]);
    expect(block("shot-0")).toMatchObject({ kind: "shot", label: "Hook", handles: ["end"], tone: "bg-shot-hook", muted: false });
    expect(block("shot-1").handles).toEqual(["start", "end"]);
    expect(block("shot-2")).toMatchObject({ handles: ["start"], tone: "bg-shot-th" });
    expect(block("cut-0")).toMatchObject({ kind: "cut", handles: [], muted: false });
    expect(block("cut-1")).toMatchObject({ label: "“um”", muted: true });
    expect(block("ph-0")).toMatchObject({ kind: "phrase", label: "Morning routines", handles: ["start", "end"] });
    expect(block("ov-0")).toMatchObject({ kind: "overlay", label: "sunrise kitchen", handles: ["start", "end", "move"], muted: false, startMs: 5000, endMs: 9000 });
    expect(block("mg-0")).toMatchObject({ kind: "mg", label: "Stat", handles: ["start", "end", "move"] });
    const stale = blocks(editorProject({ editPlan: { ...p.editPlan!, shots: p.editPlan!.shots.map((s) => ({ ...s, kind: "Talking Head" as const })) } }));
    expect(stale.find((b) => b.id === "ov-0")!.muted).toBe(true);
    expect(blockLabel(block("shot-1"))).toBe("Shot B-Roll 0:04–0:12");
  });

  it("dragBounds clamps every handle", () => {
    const b = (id: string, h: "start" | "end" | "move") => dragBounds(p, block(id), h);
    expect(b("shot-1", "start")).toEqual({ minMs: 500, maxMs: 11500 });
    expect(b("shot-1", "end")).toEqual({ minMs: 4500, maxMs: 20500 });
    expect(b("ph-1", "start")).toEqual({ minMs: 2000, maxMs: 4300 });
    expect(b("ph-1", "end")).toEqual({ minMs: 2700, maxMs: 13000 });
    expect(b("ph-0", "start")).toEqual({ minMs: 0, maxMs: 1800 });
    expect(b("ph-2", "end")).toEqual({ minMs: 13200, maxMs: 21000 });
    expect(b("ov-0", "start")).toEqual({ minMs: 4000, maxMs: 8500 });
    expect(b("ov-0", "end")).toEqual({ minMs: 5500, maxMs: 12000 });
    expect(b("ov-0", "move")).toEqual({ minMs: 4000, maxMs: 8000 });
    expect(b("mg-0", "start")).toEqual({ minMs: 0, maxMs: 2500 });
    expect(b("mg-0", "end")).toEqual({ minMs: 1500, maxMs: 21000 });
    expect(b("mg-0", "move")).toEqual({ minMs: 0, maxMs: 19000 });
    const orphan: Block = { ...block("ov-0"), id: "ov-x" };
    expect(dragBounds(editorProject({ overlays: [{ ...p.overlays[0], id: "ov-x", shotId: "gone" }] }), orphan, "end")).toEqual({ minMs: 9000, maxMs: 9000 });
  });

  it("snap pulls to a nearby edge only", () => {
    const points = snapPoints(p, block("ov-0"));
    expect(points).toContain(4000);
    expect(points).not.toContain(5000); // the dragged block's own edges
    expect(snap(4120, points, 1)).toBe(4000);
    expect(snap(4200, points, 1)).toBe(4200);
    expect(snap(4200, points, 0.25)).toBe(4000); // 8 px is more time when zoomed out
  });

  it("dragToActions emits one action per block kind", () => {
    expect(dragToActions(block("shot-1"), 4000, 10000.4)).toEqual([{ type: "setShotBounds", shotId: "shot-1", endMs: 10000 }]);
    expect(dragToActions(block("shot-1"), 4500, 12000)).toEqual([{ type: "setShotBounds", shotId: "shot-1", startMs: 4500 }]);
    expect(dragToActions(block("ph-1"), 2600, 4500)).toEqual([{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 2600, endMs: 4500 }]);
    expect(dragToActions(block("ov-0"), 6000, 10000)).toEqual([{ type: "setOverlay", overlayId: "ov-0", startMs: 6000, endMs: 10000 }]);
    expect(dragToActions(block("mg-0"), 1000, 2500)).toEqual([{ type: "updateMotionGraphic", mgId: "mg-0", startMs: 1000, endMs: 2500 }]);
    expect(dragToActions(block("cut-0"), 0, 1)).toEqual([]);
  });

  it("blocks keep a minimum width", () => {
    expect(blockWidthPx({ ...block("cut-0"), startMs: 0, endMs: 50 }, 0.25)).toBe(8);
    expect(blockWidthPx(block("ov-0"), 1)).toBe(240);
    expect(pxToMs(msToPx(1234, 3), 3)).toBeCloseTo(1234);
  });
});
