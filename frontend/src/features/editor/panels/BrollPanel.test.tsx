import { renderToStaticMarkup } from "react-dom/server";
import { BrollPanel, overlayRows } from "./BrollPanel";
import type { MotionGraphic, Overlay, Project, Shot } from "@shared/types";

const shots: Shot[] = [
  { id: "shot-0", kind: "Hook", startMs: 0, endMs: 4000 },
  { id: "shot-1", kind: "B-Roll", startMs: 4000, endMs: 12000 },
  { id: "shot-2", kind: "Talking Head & B-Roll", startMs: 12000, endMs: 21000 },
];
const ov = (id: string, shotId: string, startMs: number, endMs: number, extra: Partial<Overlay> = {}): Overlay => ({
  id, shotId, assetId: `a-${id}`, media: "image", source: "stock", startMs, endMs, placement: "full", transition: "fade", enabled: true,
  query: "water", prompt: "", intent: "", attribution: { author: "Jane Doe", url: "https://www.pexels.com/photo/1" }, ...extra,
});
const project = (patch: Partial<Project> = {}) => ({
  id: "p", mediaSource: "stock", warnings: [], creditsUsedCents: 0, motionGraphics: [], editPlan: { cuts: [], shots },
  overlays: [ov("ov-0", "shot-1", 4300, 9300), ov("ov-1", "shot-0", 300, 2300)], ...patch,
}) as unknown as Project;
const panel = (p: Project) => renderToStaticMarkup(<BrollPanel project={p} busy={false} jobBusy={false} onAdd={() => {}} onGenerate={() => {}} commit={async () => {}} onSeek={() => {}} />);

describe("BrollPanel", () => {
  it("overlayRows labels overlays with their shot and flags stale ones", () => {
    expect(overlayRows(project()).map((r) => [r.overlay.id, r.label, r.stale])).toEqual([
      ["ov-0", "B-Roll · 0:04–0:09", false],
      ["ov-1", "Hook · 0:00–0:02", true],
    ]);
    expect(panel(project())).toContain("shot changed — refresh");
  });

  it("shows the no_broll_shots hint", () => {
    const html = panel(project({ overlays: [], warnings: ["no_broll_shots"] }));
    expect(html).toContain("Mark shots as B-Roll in the edit plan first");
    expect(html).toContain(">Add B-roll<");
    expect(panel(project({ warnings: ["broll_not_found:beat-0", "broll_not_found:beat-2"] }))).toContain("No media found for 2 beat(s)");
  });

  it("replace input only accepts images and mp4", () => {
    expect(panel(project())).toContain('accept="image/png,image/jpeg,image/webp,video/mp4"');
  });

  it("Edit appears only for motion graphics with props", () => {
    const mg = (id: string, name: string, props: MotionGraphic["props"]): MotionGraphic =>
      ({ id, name, code: "", compiled: "", startMs: 4000, endMs: 6000, box: { x: 0, y: 0, w: 1, h: 1 }, enabled: true, props });
    const html = panel(project({ motionGraphics: [mg("mg-0", "Stat", [{ key: "label", type: "text", value: "x" }]), mg("mg-1", "Plain", [])] }));
    expect(html).toContain('aria-label="Edit Stat"');
    expect(html).not.toContain('aria-label="Edit Plain"');
  });

  it("lists motion graphics with a switch", () => {
    const mg = { id: "mg-0", name: "Stat", code: "", compiled: "", startMs: 1000, endMs: 3000, box: { x: 0, y: 0, w: 1, h: 1 }, props: [], enabled: true };
    const html = panel(project({ motionGraphics: [mg] }));
    expect(html).toContain("Stat · 0:01–0:03");
    expect(html).toMatch(/role="switch"[^>]*aria-label="Show Stat"/);
  });

  it("shows attribution, credits and the media source", () => {
    const html = panel(project({ creditsUsedCents: 26 }));
    expect(html).toContain("Photo: Jane Doe / Pexels");
    expect(html).toContain("$0.26 used");
    expect(html).toContain(">Refresh B-roll<");
  });

  it("delete asks first", () => {
    const html = panel(project());
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Delete</);
    expect(html).toMatch(/<dialog[^>]*>.*>Delete<\/button>.*>Cancel<\/button>/s); // one confirm sheet; its title names what is deleted when it opens
  });

  it("media source is a radiogroup", () => {
    const html = panel(project());
    expect(html).toContain('role="radiogroup" aria-label="Media source"');
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Stock only</);
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>Generate \(fal.ai\)</);
  });

  it("asks for a plan first", () => {
    expect(panel(project({ editPlan: null, overlays: [] }))).toContain("Plan the edit first");
  });


  it("each overlay has a New… button", () => {
    const html = panel(project());
    expect(html.match(/aria-label="New media for [^"]+"[^>]*>New…</g)).toHaveLength(2);
  });

  it("says when the monthly cap stopped generation", () => {
    expect(panel(project({ warnings: ["over_cap"] }))).toMatch(/Monthly spending cap reached — see <a href="\/usage"[^>]*>Usage<\/a>\./);
  });
});

