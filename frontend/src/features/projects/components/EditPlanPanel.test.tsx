import { renderToStaticMarkup } from "react-dom/server";
import { EditPlanPanel, planChanges, shotLayout } from "./EditPlanPanel";
import type { Project, Shot } from "@shared/types";

const shot = (id: string, startMs: number, endMs: number, kind: Shot["kind"] = "Talking Head"): Shot => ({ id, kind, startMs, endMs });
const project = {
  burnInLanguage: null,
  editPlan: {
    cuts: [{ id: "cut-0", startMs: 17950, endMs: 21000, reason: "pause", text: "", shouldTrim: true }],
    shots: [shot("shot-0", 0, 4259, "Hook"), shot("shot-1", 4259, 21000)],
  },
} as unknown as Project;

describe("EditPlanPanel helpers", () => {
  it("shotLayout maps ms to percentages", () => {
    expect(shotLayout([shot("a", 0, 5000), shot("b", 5000, 20000)], 20000)).toEqual([{ id: "a", leftPct: 0, widthPct: 25 }, { id: "b", leftPct: 25, widthPct: 75 }]);
  });

  it("planChanges returns only real differences", () => {
    expect(planChanges(project, { trim: { "cut-0": true }, kinds: {} })).toBeNull(); // same as saved
    expect(planChanges(project, { trim: { "cut-0": false }, kinds: { "shot-1": "B-Roll" } }))
      .toEqual([{ type: "setCut", cutId: "cut-0", shouldTrim: false }, { type: "setShotKind", shotId: "shot-1", kind: "B-Roll" }]);
    expect(planChanges(project, { trim: {}, kinds: { "shot-0": "Hook" }, burnIn: null })).toBeNull();
    expect(planChanges(project, { trim: {}, kinds: {}, burnIn: "es" })).toEqual([{ type: "setBurnIn", language: "es" }]);
  });
});

describe("EditPlanPanel", () => {
  it("lists every shot with its own kind select, so small shots stay tappable on a phone", () => {
    // 3-minute clip, 20 shots: each scrubber block would be ~17 px wide at 375 px.
    const shots = Array.from({ length: 20 }, (_, i) => shot(`shot-${i}`, i * 9000, (i + 1) * 9000, i ? "Talking Head" : "Hook"));
    const p = { ...project, translations: [], editPlan: { cuts: [], shots } } as unknown as Project;
    const html = renderToStaticMarkup(<EditPlanPanel project={p} busy={false} onPlan={() => {}} onUpdate={() => {}} onSeek={() => {}} />);
    const selects = html.match(/<select[^>]*aria-label="Shot at [^"]*"/g) ?? [];
    expect(selects).toHaveLength(20);
    expect(selects[3]).toContain('aria-label="Shot at 0:27.0"');
  });
});
