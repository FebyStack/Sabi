import { editorProject } from "@shared/editing/fixtures";
import { keyToEffect } from "./keyboard";

const p = editorProject();
const ov = { kind: "overlay" as const, id: "ov-0" };
const mg = { kind: "mg" as const, id: "mg-0" };

describe("timeline keyboard", () => {
  it("arrows nudge, shift nudges more, delete removes, escape deselects", () => {
    expect(keyToEffect("ArrowRight", false, ov, p)).toEqual({ type: "commit", actions: [{ type: "setOverlay", overlayId: "ov-0", startMs: 5100, endMs: 9100 }] });
    expect(keyToEffect("ArrowLeft", true, ov, p)).toEqual({ type: "commit", actions: [{ type: "setOverlay", overlayId: "ov-0", startMs: 4000, endMs: 8000 }] });
    expect(keyToEffect("ArrowLeft", true, mg, p)).toEqual({ type: "commit", actions: [{ type: "updateMotionGraphic", mgId: "mg-0", startMs: 0, endMs: 2000 }] });
    expect(keyToEffect("ArrowLeft", false, mg, editorProject({ motionGraphics: [{ ...p.motionGraphics[0], startMs: 0, endMs: 2000 }] }))).toBeNull(); // at the bound
    expect(keyToEffect("ArrowRight", false, { kind: "phrase", id: "ph-1" }, p)).toEqual({ type: "commit", actions: [{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 2600, endMs: 4600 }] });
    expect(keyToEffect("ArrowLeft", false, { kind: "shot", id: "shot-1" }, p)).toEqual({ type: "commit", actions: [{ type: "setShotBounds", shotId: "shot-1", endMs: 11900 }] });
    expect(keyToEffect("ArrowLeft", false, { kind: "shot", id: "shot-2" }, p)).toBeNull(); // the last end never moves
    expect(keyToEffect("ArrowLeft", false, null, p)).toBeNull();
    expect(keyToEffect("Delete", false, ov, p)).toEqual({ type: "commit", actions: [{ type: "removeOverlay", overlayId: "ov-0" }] });
    expect(keyToEffect("Backspace", false, mg, p)).toEqual({ type: "commit", actions: [{ type: "removeMotionGraphic", mgId: "mg-0" }] });
    expect(keyToEffect("Delete", false, { kind: "shot", id: "shot-0" }, p)).toBeNull();
    expect(keyToEffect("Escape", false, ov, p)).toEqual({ type: "select", selected: null });
    expect(keyToEffect(" ", false, null, p)).toBe("play");
    expect(keyToEffect("a", false, ov, p)).toBeNull();
  });
});
