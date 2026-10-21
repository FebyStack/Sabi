import type { Action, Project } from "../types";
import { applyLocal, applyLocalAction } from "./applyLocal";
import { editorProject } from "./fixtures";

const ok = (project: Project, actions: Action[]) => {
  const out = applyLocal(project, actions);
  if ("error" in out) throw new Error(`${out.error} ${out.id ?? ""}`);
  return out;
};
const shots = (p: Project) => p.editPlan!.shots.map((s) => [s.startMs, s.endMs]);

describe("applyLocal", () => {
  const project = editorProject();

  it("setShotBounds moves the shared edge", () => {
    const end = ok(project, [{ type: "setShotBounds", shotId: "shot-1", endMs: 10000 }]);
    expect(shots(end.project)).toEqual([[0, 4000], [4000, 10000], [10000, 21000]]);
    const start = ok(project, [{ type: "setShotBounds", shotId: "shot-1", startMs: 4500 }]);
    expect(shots(start.project)).toEqual([[0, 4500], [4500, 12000], [12000, 21000]]);
    expect(shots(project)).toEqual([[0, 4000], [4000, 12000], [12000, 21000]]); // pure
  });

  it("setShotBounds keeps neighbours at least 500 ms", () => {
    expect(applyLocal(project, [{ type: "setShotBounds", shotId: "shot-0", endMs: 11700 }])).toEqual({ error: "out_of_range", id: "shot-0" });
    expect(applyLocal(project, [{ type: "setShotBounds", shotId: "shot-1", endMs: 4300 }])).toEqual({ error: "out_of_range", id: "shot-1" });
    expect(applyLocal(project, [{ type: "setShotBounds", shotId: "shot-0", startMs: 100 }])).toEqual({ error: "out_of_range", id: "shot-0" });
    expect(applyLocal(project, [{ type: "setShotBounds", shotId: "shot-2", endMs: 20000 }])).toEqual({ error: "out_of_range", id: "shot-2" });
    expect(applyLocal(project, [{ type: "setShotBounds", shotId: "shot-9", endMs: 5000 }])).toEqual({ error: "unknown_id", id: "shot-9" });
    expect(applyLocal({ ...project, editPlan: null }, [{ type: "setShotBounds", shotId: "shot-0", endMs: 5000 }])).toEqual({ error: "no_plan" });
  });

  it("retimePhraseRange refuses overlap", () => {
    expect(applyLocal(project, [{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 1900, endMs: 4500 }])).toEqual({ error: "overlap", id: "ph-1" });
    expect(applyLocal(project, [{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 2500, endMs: 13500 }])).toEqual({ error: "overlap", id: "ph-1" });
    expect(applyLocal(project, [{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 2500, endMs: 2660 }])).toEqual({ error: "out_of_range", id: "ph-1" });
    expect(applyLocal(project, [{ type: "retimePhraseRange", phraseId: "ph-9", startMs: 2500, endMs: 4000 }])).toEqual({ error: "unknown_id", id: "ph-9" });
    expect(applyLocal({ ...project, phrases: [] }, [{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 2500, endMs: 4000 }])).toEqual({ error: "no_captions" });
  });

  it("retimePhraseRange scales words", () => {
    const out = ok(project, [{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 3000, endMs: 7000 }]);
    const p = out.project.phrases[1];
    expect([p.startMs, p.endMs]).toEqual([3000, 7000]);
    expect(p.words.map((w) => [w.startMs, w.endMs])).toEqual([[3000, 4000], [4000, 7000]]);
    expect(out.project.phrases[0]).toBe(project.phrases[0]);
    expect(out.rerender).toBe(true);
  });

  it("word emphasis and emoji edit one phrase", () => {
    const em = ok(project, [{ type: "setWordEmphasis", phraseId: "ph-0", wordId: "w-1", emphasis: "pictorial" }]);
    expect(em.project.phrases[0].words[1].emphasis).toBe("pictorial");
    expect(em.project.phrases[1]).toBe(project.phrases[1]);
    const clear = ok(project, [{ type: "setWordEmphasis", phraseId: "ph-1", wordId: "w-3", emphasis: null }]);
    expect("emphasis" in clear.project.phrases[1].words[1]).toBe(false);
    expect(applyLocal(project, [{ type: "setWordEmphasis", phraseId: "ph-0", wordId: "w-9", emphasis: "noun" }])).toEqual({ error: "unknown_id", id: "w-9" });
    const emoji = ok(project, [{ type: "setPhraseEmoji", phraseId: "ph-0", emoji: "🛏️" }, { type: "setPhraseEmoji", phraseId: "ph-2", emoji: null }]);
    expect(emoji.project.phrases[0].emoji).toBe("🛏️");
    expect("emoji" in emoji.project.phrases[2]).toBe(false);
    expect(applyLocal(project, [{ type: "setPhraseEmoji", phraseId: "ph-9", emoji: "x" }])).toEqual({ error: "unknown_id", id: "ph-9" });
  });

  it("caption style sets and clears", () => {
    const set = ok(project, [{ type: "setCaptionStyle", style: { sizePx: 96, uppercase: true } }]);
    expect(set.project.captionStyle).toEqual({ sizePx: 96, uppercase: true });
    expect(set.rerender).toBe(true);
    expect(ok(set.project, [{ type: "setCaptionStyle", style: null }]).project.captionStyle).toBeNull();
  });

  it("shot edits rerender only with overlays", () => {
    const bounds: Action = { type: "setShotBounds", shotId: "shot-1", endMs: 10000 };
    const kind: Action = { type: "setShotKind", shotId: "shot-2", kind: "B-Roll" };
    expect(ok(project, [bounds]).rerender).toBe(true);
    expect(ok(project, [kind]).rerender).toBe(true);
    const bare = { ...project, overlays: [] };
    expect(ok(bare, [bounds]).rerender).toBe(false);
    expect(ok(bare, [kind]).rerender).toBe(false);
    expect(ok(project, [{ type: "setTitle", title: "x" }, { type: "setMediaSource", mediaSource: "generate" }]).rerender).toBe(false);
  });

  it("stops at the first error and keeps the project", () => {
    const before = structuredClone(project);
    expect(applyLocal(project, [{ type: "setTitle", title: "New" }, { type: "setCut", cutId: "cut-9", shouldTrim: true }, { type: "setCaptionStyle", style: null }]))
      .toEqual({ error: "unknown_id", id: "cut-9" });
    expect(project).toEqual(before);
    const two = ok(project, [{ type: "setTitle", title: "New" }, { type: "setCut", cutId: "cut-1", shouldTrim: true }]);
    expect(two).toMatchObject({ rerender: true, project: { title: "New" } });
    expect(two.project.editPlan!.cuts[1].shouldTrim).toBe(true);
  });

  it("moved plan rules: overlays stay in their shot, burn-in needs a translation, MGs stay in the source", () => {
    expect(applyLocal(project, [{ type: "setOverlay", overlayId: "ov-0", endMs: 12001 }])).toEqual({ error: "out_of_shot", id: "ov-0" });
    expect(applyLocal(project, [{ type: "setBurnIn", language: "es" }])).toEqual({ error: "bad_burn_in" });
    expect(applyLocal(project, [{ type: "updateMotionGraphic", mgId: "mg-0", endMs: 21001 }])).toEqual({ error: "out_of_range", id: "mg-0" });
    expect(ok(project, [{ type: "updateMotionGraphic", mgId: "mg-0", endMs: 5000, enabled: false }]).project.motionGraphics[0]).toMatchObject({ endMs: 5000, enabled: false, compiled: "c" });
    expect(ok(project, [{ type: "removeOverlay", overlayId: "ov-0" }, { type: "removeMotionGraphic", mgId: "mg-0" }]).project).toMatchObject({ overlays: [], motionGraphics: [] });
    // A batch sees its own earlier steps: widen the shot, then move the overlay into the new room.
    expect(ok(project, [{ type: "setShotBounds", shotId: "shot-1", endMs: 14000 }, { type: "setOverlay", overlayId: "ov-0", endMs: 13500 }]).project.overlays[0].endMs).toBe(13500);
  });

  it("server-only actions are refused locally", () => {
    expect(() => applyLocalAction(project, { type: "setBrand", brand: null })).toThrow("server_only");
  });
});
