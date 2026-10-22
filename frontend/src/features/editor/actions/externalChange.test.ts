import { editorProject } from "@shared/editing/fixtures";
import { changedIds, isExternal } from "./externalChange";

describe("externalChange", () => {
  it("names changed overlays, phrases, shots and the brand", () => {
    const prev = editorProject();
    const next = editorProject({
      title: "Agent title",
      overlays: [{ ...prev.overlays[0], endMs: 8000 }],
      phrases: prev.phrases.map((p, i) => (i === 1 ? { ...p, emoji: "🛏️" } : p)),
      editPlan: { ...prev.editPlan!, shots: prev.editPlan!.shots.map((s) => (s.id === "shot-2" ? { ...s, kind: "B-Roll" as const } : s)) },
      motionGraphics: [...prev.motionGraphics, { ...prev.motionGraphics[0], id: "mg-1" }],
      brand: { palette: { primary: "#111111", accent: "#222222", text: "#ffffff", background: "#000000" }, fontFamily: "Inter", logoAssetId: null, grade: 0.4 },
    });
    expect(changedIds(prev, next).sort()).toEqual(["brand", "mg-1", "ov-0", "ph-1", "shot-2", "title"]);
    expect(changedIds(prev, editorProject({ overlays: [], captionStyle: { sizePx: 90 }, captionTemplateId: "bold" })).sort()).toEqual(["captionStyle", "ov-0", "template"]);
    expect(changedIds(prev, editorProject())).toEqual([]);
  });

  it("own versions are not external", () => {
    const own = new Set(["v2"]);
    expect(isExternal(editorProject({ updatedAt: "v2" }), own)).toBe(false);
    expect(isExternal(editorProject({ updatedAt: "v3" }), own)).toBe(true);
  });
});
