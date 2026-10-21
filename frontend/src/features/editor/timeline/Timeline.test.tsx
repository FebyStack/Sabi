import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Project } from "@shared/types";
import { createEditorStore, type EditorState } from "../store/editorStore";
import { msToPx } from "./layout";
import { Timeline } from "./Timeline";

const markup = (project: Project, state: Partial<EditorState> = {}) =>
  renderToStaticMarkup(<Timeline project={project} store={createEditorStore(state)} commit={async () => {}} onPlay={() => {}} onSeek={() => {}} onGenerate={() => {}} />);
const buttonFor = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-id="${id}"[^>]*>`))?.[0] ?? "";

describe("Timeline", () => {
  it("renders five tracks with labelled blocks", () => {
    const html = markup(editorProject());
    expect(html).toContain('role="group" aria-label="Timeline"');
    for (const t of ["Shots", "Cuts", "Captions", "B-roll", "Motion graphics"]) expect(html).toContain(`role="list" aria-label="${t}"`);
    expect(buttonFor(html, "shot-1")).toContain('aria-label="Shot B-Roll 0:04–0:12"');
    expect(buttonFor(html, "ov-0")).toContain('aria-label="B-roll sunrise kitchen 0:05–0:09"');
    expect(html).toContain("touch-action:pan-y");
  });

  it("shades enabled cuts and draws the playhead in source time", () => {
    const p = editorProject({ editPlan: { ...editorProject().editPlan!, cuts: [{ id: "cut-0", startMs: 1000, endMs: 2000, reason: "pause", text: "", shouldTrim: true }] } });
    const html = markup(p, { playheadMs: 1500 });
    expect(html).toMatch(new RegExp(`data-playhead[^>]*left:${msToPx(2500, 1)}px`));
    expect(html).toMatch(/data-cut-band[^>]*left:60px;width:60px/);
  });

  it("pulses changed blocks", () => {
    const html = markup(editorProject(), { changed: { ids: ["ov-0"], at: 1 } });
    expect(buttonFor(html, "ov-0")).toContain("pulse");
    expect(buttonFor(html, "mg-0")).not.toContain("pulse");
  });

  it("blocks keep a minimum width", () => {
    const p = editorProject({ editPlan: { ...editorProject().editPlan!, cuts: [{ id: "cut-0", startMs: 1000, endMs: 1050, reason: "filler", text: "uh", shouldTrim: true }] } });
    expect(markup(p, { zoom: 0.25 })).toMatch(/data-id="cut-0"[^>]*width:8px|width:8px[^>]*data-id="cut-0"/);
  });

  it("marks the selection and draws the drag preview", () => {
    const html = markup(editorProject(), { selection: { kind: "overlay", id: "ov-0" }, drag: { actions: [{ type: "setOverlay", overlayId: "ov-0", endMs: 10000 }] } });
    expect(buttonFor(html, "ov-0")).toContain('aria-pressed="true"');
    expect(buttonFor(html, "ov-0")).toContain(`width:${msToPx(5000, 1)}px`);
  });

  it("shows the empty state without captions", () => {
    const html = markup(editorProject({ phrases: [], editPlan: null, overlays: [], motionGraphics: [] }));
    expect(html).toContain("Generate captions");
    expect(html).toContain('role="status"');
  });
});
