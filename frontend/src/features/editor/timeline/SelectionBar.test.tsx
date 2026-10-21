import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { editorProject } from "@shared/editing/fixtures";
import type { Project } from "@shared/types";
import type { Selected } from "../store/editorStore";
import { SelectionBar, nudgeEnd } from "./SelectionBar";

const bar = (project: Project, selected: Selected) => renderToStaticMarkup(
  <MemoryRouter><SelectionBar project={project} selected={selected} commit={async () => {}} onAdd={() => {}} /></MemoryRouter>);
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

describe("SelectionBar", () => {
  it("the selection bar nudges an overlay inside its shot", () => {
    const p = editorProject({ overlays: [{ ...editorProject().overlays[0], startMs: 9000, endMs: 12000 }] }); // ends at the shot end
    const sel: Selected = { kind: "overlay", id: "ov-0" };
    const html = bar(p, sel);
    expect(html).toContain("0:09–0:12");
    expect(button(html, "End \\+0\\.5 s")).toContain(`disabled=""`);
    expect(button(html, "End −0\\.5 s")).not.toContain(`disabled=""`);
    expect(nudgeEnd(p, sel, 500)).toBeNull();
    expect(nudgeEnd(p, sel, -500)).toEqual([{ type: "setOverlay", overlayId: "ov-0", endMs: 11500 }]);
    expect(nudgeEnd(editorProject(), { kind: "phrase", id: "ph-1" }, 500)).toEqual([{ type: "retimePhraseRange", phraseId: "ph-1", startMs: 2500, endMs: 5000 }]);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Placement"');
  });

  it("a shot selection changes its kind", () => {
    const html = bar(editorProject(), { kind: "shot", id: "shot-1" });
    expect(html).toContain('role="radiogroup" aria-label="Shot kind"');
    expect(html).toMatch(/aria-checked="true"[^>]*>B-Roll</);
  });

  it("a cut selection toggles with a switch", () => {
    const html = bar(editorProject(), { kind: "cut", id: "cut-0" });
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Cut this pause"/);
    expect(bar(editorProject(), { kind: "cut", id: "cut-1" })).toMatch(/role="switch" aria-checked="false"/);
  });

  it("delete asks first", () => {
    const html = bar(editorProject(), { kind: "mg", id: "mg-0" });
    expect(button(html, "Delete Stat")).toContain('aria-haspopup="dialog"');
    expect(html).toMatch(/<dialog[^>]*>.*Delete this motion graphic\?.*>Delete<\/button>/s);
  });
});
