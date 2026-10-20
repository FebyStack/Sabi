import { renderToStaticMarkup } from "react-dom/server";
import { BrollPanel, actionErrorNotice, overlayRows } from "./BrollPanel";
import type { Overlay, Project, Shot } from "@shared/types";

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
const panel = (p: Project, notice: string | null = null) => renderToStaticMarkup(
  <BrollPanel project={p} busy={false} notice={notice} onMediaSource={() => {}} onAdd={() => {}} onActions={() => {}} onSeek={() => {}} />);

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

  it("end-time buttons clamp to the shot", () => {
    const html = panel(project({ overlays: [ov("ov-0", "shot-1", 4300, 12000)] }));
    expect(html).toMatch(/<button[^>]*aria-label="End \+0\.5 s"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*aria-label="End −0\.5 s"[^>]*disabled=""/);
  });

  it("replace input only accepts images and mp4", () => {
    expect(panel(project())).toContain('accept="image/png,image/jpeg,image/webp,video/mp4"');
  });

  it("lists motion graphics with a switch", () => {
    const mg = { id: "mg-0", name: "Stat", code: "", compiled: "", startMs: 1000, endMs: 3000, box: { x: 0, y: 0, w: 1, h: 1 }, props: [], enabled: true };
    const html = panel(project({ motionGraphics: [mg] }));
    expect(html).toContain("Stat · 0:01–0:03");
    expect(html).toMatch(/role="switch"[^>]*aria-label="Show Stat"/);
  });

  it("shows attribution, credits and the media source", () => {
    const html = panel(project({ creditsUsedCents: 26 }), "Project changed elsewhere — reloaded, try again");
    expect(html).toContain("Photo: Jane Doe / Pexels");
    expect(html).toContain("$0.26 used");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Stock only</);
    expect(html).toContain(">Refresh B-roll<");
    expect(html).toContain("Project changed elsewhere — reloaded, try again");
  });

  it("a stale action refetches and explains", () => {
    expect(actionErrorNotice(new Error("stale"))).toBe("Project changed elsewhere — reloaded, try again");
    expect(actionErrorNotice(new Error("bad_asset"))).toBeNull();
  });
});
