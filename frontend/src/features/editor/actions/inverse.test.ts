import { applyLocal } from "@shared/editing/applyLocal";
import { editorProject } from "@shared/editing/fixtures";
import type { Action } from "@shared/types";
import { inverseActions } from "./inverse";

const p = editorProject({ translations: [{ language: "es", phrases: [] }] });
const brand = { palette: { primary: "#111111", accent: "#222222", text: "#ffffff", background: "#000000" }, fontFamily: "Inter" as const, logoAssetId: null, grade: 0.4 };

describe("inverseActions", () => {
  it("inverts every undoable action from the pre-state", () => {
    const cases: [Action, Action][] = [
      [{ type: "setTitle", title: "New" }, { type: "setTitle", title: "Morning" }],
      [{ type: "setMediaSource", mediaSource: "generate" }, { type: "setMediaSource", mediaSource: "stock" }],
      [{ type: "setTemplate", captionTemplateId: "bold" }, { type: "setTemplate", captionTemplateId: "clean" }],
      [{ type: "setBurnIn", language: "es" }, { type: "setBurnIn", language: null }],
      [{ type: "setCut", cutId: "cut-1", shouldTrim: true }, { type: "setCut", cutId: "cut-1", shouldTrim: false }],
      [{ type: "setShotKind", shotId: "shot-2", kind: "B-Roll" }, { type: "setShotKind", shotId: "shot-2", kind: "Talking Head" }],
      [{ type: "setShotBounds", shotId: "shot-1", endMs: 10000 }, { type: "setShotBounds", shotId: "shot-1", endMs: 12000 }],
      [{ type: "setShotBounds", shotId: "shot-1", startMs: 4500 }, { type: "setShotBounds", shotId: "shot-1", startMs: 4000 }],
      [{ type: "setOverlay", overlayId: "ov-0", endMs: 8000, placement: "top" }, { type: "setOverlay", overlayId: "ov-0", endMs: 9000, placement: "full" }],
      [{ type: "editPhrase", phraseId: "ph-0", text: "Evening routines" }, { type: "editPhrase", phraseId: "ph-0", text: "Morning routines" }],
      [{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 2600, endMs: 5000 }, { type: "retimePhraseRange", phraseId: "ph-1", startMs: 2500, endMs: 4500 }],
      [{ type: "setWordEmphasis", phraseId: "ph-1", wordId: "w-3", emphasis: null }, { type: "setWordEmphasis", phraseId: "ph-1", wordId: "w-3", emphasis: "keyword" }],
      [{ type: "setWordEmphasis", phraseId: "ph-0", wordId: "w-0", emphasis: "noun" }, { type: "setWordEmphasis", phraseId: "ph-0", wordId: "w-0", emphasis: null }],
      [{ type: "setPhraseEmoji", phraseId: "ph-2", emoji: null }, { type: "setPhraseEmoji", phraseId: "ph-2", emoji: "☀️" }],
      [{ type: "setCaptionStyle", style: { sizePx: 96 } }, { type: "setCaptionStyle", style: null }],
      [{ type: "setBrand", brand }, { type: "setBrand", brand: null }],
      [{ type: "updateMotionGraphic", mgId: "mg-0", endMs: 5000, enabled: false }, { type: "updateMotionGraphic", mgId: "mg-0", endMs: 3000, enabled: true }],
    ];
    for (const [forward, inverse] of cases) expect(inverseActions(p, [forward])).toEqual([inverse]);
  });

  it("is null for deletes and adds", () => {
    expect(inverseActions(p, [{ type: "setTitle", title: "x" }, { type: "removeOverlay", overlayId: "ov-0" }])).toBeNull();
    expect(inverseActions(p, [{ type: "removeMotionGraphic", mgId: "mg-0" }])).toBeNull();
    expect(inverseActions(p, [{ type: "replaceOverlay", overlayId: "ov-0", assetId: "a" }])).toBeNull();
    expect(inverseActions(p, [{ type: "addMotionGraphic", name: "x", code: "c", startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: [] }])).toBeNull();
    expect(inverseActions(p, [{ type: "updateMotionGraphic", mgId: "mg-0", code: "const Component = () => null;" }])).toBeNull();
  });

  it("reverses the order", () => {
    const forward: Action[] = [{ type: "setShotBounds", shotId: "shot-1", endMs: 14000 }, { type: "setOverlay", overlayId: "ov-0", endMs: 13500 }];
    const inverse = inverseActions(p, forward)!;
    expect(inverse).toEqual([{ type: "setOverlay", overlayId: "ov-0", endMs: 9000 }, { type: "setShotBounds", shotId: "shot-1", endMs: 12000 }]);
    const there = applyLocal(p, forward);
    if ("error" in there) throw new Error(there.error);
    const back = applyLocal(there.project, inverse);
    expect("project" in back && back.project).toEqual(p);
  });
});
