import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCaptionTemplate } from "../captions/templates";
import { templateLook } from "../editing/brand";
import type { MotionGraphicProps } from "../editing/overlays";
import { MotionGraphicLayer, mgWindow, sandboxKey } from "./MotionGraphicLayer";

const at = vi.hoisted(() => ({ frame: 45 }));
vi.mock("remotion", async (orig) => ({
  ...(await orig<typeof import("remotion")>()),
  useCurrentFrame: () => at.frame,
  useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920 }),
  getRemotionEnvironment: () => ({ isRendering: false }),
}));

const brand = templateLook(getCaptionTemplate("clean"));
const mg = (extra: Partial<MotionGraphicProps> = {}): MotionGraphicProps =>
  ({ id: "mg-0", compiled: "const Component = () => null;", startMs: 1000, endMs: 2000, box: { x: 0, y: 0, w: 1, h: 0.2 }, props: { title: "Hi" }, images: [], ...extra });
const layer = (m: MotionGraphicProps) => renderToStaticMarkup(createElement(MotionGraphicLayer, { mg: m, brand, width: 1080, height: 1920 }));

describe("MotionGraphicLayer (the page side of an MG sandbox)", () => {
  it("mgWindow places the MG's range on the timeline", () => {
    expect(mgWindow(mg(), 30, 29)).toMatchObject({ active: false, local: -1 });
    expect(mgWindow(mg(), 30, 30)).toMatchObject({ active: true, local: 0, from: 30, durationInFrames: 30 });
    expect(mgWindow(mg(), 30, 59)).toMatchObject({ active: true, local: 29 });
    expect(mgWindow(mg(), 30, 60)).toMatchObject({ active: false });
    expect(mgWindow(mg({ endMs: 1010 }), 30, 30).durationInFrames).toBe(0);
  });

  it("a new sandbox only for new code, a new image or a new logo", () => {
    const k = sandboxKey(mg(), brand);
    expect(sandboxKey(mg({ compiled: "const Component = () => 1;" }), brand)).not.toBe(k);
    expect(sandboxKey(mg({ images: ["/f/a1"] }), brand)).not.toBe(k);
    expect(sandboxKey(mg(), { ...brand, logoUrl: "/f/logo" })).not.toBe(k);
    expect(sandboxKey(mg({ props: { title: "Other" } }), { ...brand, accent: "#000000" })).toBe(k);
  });

  it("draws an opaque-origin iframe over the MG's box, hidden outside its range", () => {
    at.frame = 45;
    const html = layer(mg());
    for (const s of ['sandbox="allow-scripts"', 'src="/mg-sandbox.html"', 'title="mg-0"', 'aria-hidden="true"', 'tabindex="-1"',
      "width:1080px", "height:384px", "pointer-events:none", "color-scheme:normal", "visibility:visible"]) expect(html).toContain(s);
    expect(html).not.toContain("allow-same-origin");
    at.frame = 100;
    expect(layer(mg())).toContain("visibility:hidden");
    expect(layer(mg({ endMs: 1010 }))).toBe("");
  });
});
