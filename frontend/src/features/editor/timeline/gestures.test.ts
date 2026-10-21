import { editorProject } from "@shared/editing/fixtures";
import { reduceGesture, type GestureEvent, type GestureState, type Hit } from "./gestures";
import { blocks, dragBounds, msToPx, snap, snapPoints, type Handle } from "./layout";

const p = editorProject();
const ov = blocks(p).find((b) => b.id === "ov-0")!;
const ctx = { zoom: 1, bounds: (b: typeof ov, h: Handle) => dragBounds(p, b, h), snap: (ms: number) => snap(ms, snapPoints(p, ov), 1) };
const idle: GestureState = { pointers: [], mode: "idle" };
const run = (events: GestureEvent[], c = ctx) => {
  let state = idle;
  const effects = events.map((e) => { const out = reduceGesture(state, e, c); state = out.state; return out.effects; });
  return { state, effects };
};
const pt = (id: number, x: number) => ({ id, x, y: 10 });
const onBlock = (handle: Handle): Hit => ({ block: ov, handle });

describe("gesture reducer", () => {
  it("a tap selects and seeks", () => {
    const { effects, state } = run([{ type: "down", pointer: pt(1, msToPx(6000, 1)), hit: onBlock("move") }, { type: "up", pointerId: 1 }]);
    expect(effects[1]).toEqual([{ type: "select", selected: { kind: "overlay", id: "ov-0" } }, { type: "seek", ms: 5000 }]);
    expect(state.mode).toBe("idle");
    const empty = run([{ type: "down", pointer: pt(1, 120), hit: { track: "broll", ms: 2000 } }, { type: "up", pointerId: 1 }]);
    expect(empty.effects[1]).toEqual([{ type: "seek", ms: 2000 }, { type: "select", selected: null }]);
  });

  it("a drag under the slop is a tap", () => {
    const x = msToPx(6000, 1);
    const { effects } = run([{ type: "down", pointer: pt(1, x), hit: onBlock("move") }, { type: "move", pointer: pt(1, x + 4) }, { type: "up", pointerId: 1 }]);
    expect(effects[1]).toEqual([]);
    expect(effects[2]).toEqual([{ type: "select", selected: { kind: "overlay", id: "ov-0" } }, { type: "seek", ms: 5000 }]);
  });

  it("a drag previews clamped snapped ranges and commits on up", () => {
    const x = msToPx(9000, 1);
    const { effects, state } = run([
      { type: "down", pointer: pt(1, x), hit: onBlock("end") },
      { type: "move", pointer: pt(1, x + 240) }, // +4 s: past the shot end, clamped to 12 000
      { type: "move", pointer: pt(1, x + 62) }, // +1 033 ms: nothing to snap to
      { type: "move", pointer: pt(1, x - 59) }, // −983 ms → 8 017: snaps to the cut edge at 8 000
      { type: "move", pointer: pt(1, x + 62) },
      { type: "up", pointerId: 1 },
    ]);
    expect(effects[1]).toEqual([{ type: "preview", actions: [{ type: "setOverlay", overlayId: "ov-0", startMs: 5000, endMs: 12000 }] }]);
    expect(effects[2]).toEqual([{ type: "preview", actions: [{ type: "setOverlay", overlayId: "ov-0", startMs: 5000, endMs: 10033 }] }]);
    expect(effects[3]).toEqual([{ type: "preview", actions: [{ type: "setOverlay", overlayId: "ov-0", startMs: 5000, endMs: 8000 }] }]);
    expect(effects[5]).toEqual([
      { type: "commit", actions: [{ type: "setOverlay", overlayId: "ov-0", startMs: 5000, endMs: 10033 }] },
      { type: "clear" }, { type: "select", selected: { kind: "overlay", id: "ov-0" } },
    ]);
    expect(state.mode).toBe("idle");
    const body = run([{ type: "down", pointer: pt(1, msToPx(6000, 1)), hit: onBlock("move") }, { type: "move", pointer: pt(1, msToPx(6000, 1) - 600) }]);
    expect(body.effects[1]).toEqual([{ type: "preview", actions: [{ type: "setOverlay", overlayId: "ov-0", startMs: 4000, endMs: 8000 }] }]); // clamped to the shot start
  });

  it("a horizontal drag on empty space pans", () => {
    const { effects } = run([{ type: "down", pointer: pt(1, 300), hit: { track: "mg", ms: 5000 } }, { type: "move", pointer: pt(1, 280) }, { type: "move", pointer: pt(1, 250) }, { type: "up", pointerId: 1 }]);
    expect(effects.slice(1)).toEqual([[{ type: "pan", dx: -20 }], [{ type: "pan", dx: -30 }], []]);
  });

  it("two pointers pinch-zoom around the midpoint", () => {
    const { effects, state } = run([
      { type: "down", pointer: pt(1, 100), hit: { track: "shots", ms: 1667 } },
      { type: "down", pointer: pt(2, 300), hit: { track: "shots", ms: 5000 } },
      { type: "move", pointer: pt(2, 500) },
      { type: "move", pointer: pt(2, 100000) },
    ]);
    expect(effects[1]).toEqual([{ type: "clear" }]);
    expect(state.mode).toBe("pinch");
    expect(effects[2]).toEqual([{ type: "zoom", zoom: 2, anchorMs: (200 / 60) * 1000 }]);
    expect(effects[3]).toEqual([{ type: "zoom", zoom: 8, anchorMs: (200 / 60) * 1000 }]);
  });

  it("cancel clears the preview", () => {
    const x = msToPx(9000, 1);
    const { effects, state } = run([{ type: "down", pointer: pt(1, x), hit: onBlock("end") }, { type: "move", pointer: pt(1, x + 30) }, { type: "cancel", pointerId: 1 }]);
    expect(effects[2]).toEqual([{ type: "clear" }]);
    expect(state).toEqual(idle);
  });
});
