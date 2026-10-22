import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCaptionTemplate } from "../captions/templates";
import { templateLook } from "../editing/brand";
import type { MgItem } from "./mgProtocol";
import { MG_SCOPE, MgBroken, MgView, buildMotionGraphic, withBlobUrls, type MgConfig } from "./mgRuntime";

const item: MgItem = { props: { title: "42% faster" }, brand: templateLook(getCaptionTemplate("clean")), width: 1080, height: 960, durationInFrames: 60 };
const config: MgConfig = { id: "CaptionVideo", width: 1080, height: 1920, fps: 30, durationInFrames: 60 };
const view = (code: string, frame: number | null = 12) =>
  renderToStaticMarkup(createElement(MgView, { mg: buildMotionGraphic(code), id: "mg-0", frame, item, config, report: () => {}, track: () => {} }));

describe("mgRuntime (inside the sandbox)", () => {
  it("draws the component at the given frame", () => {
    expect(view(`const Component = ({ item }) => React.createElement("div", null, item.props.title, " ", useCurrentFrame(), " ", useVideoConfig().fps);`))
      .toBe('<div style="position:absolute;inset:0;overflow:hidden"><div>42% faster 12 30</div></div>');
  });

  it("frame null draws nothing", () => {
    expect(view(`const Component = () => React.createElement("div", null, "x");`, null)).toBe("");
  });

  it("useVideoConfig is the frame and the MG's length, nothing more", () => {
    expect(view(`const Component = () => JSON.stringify(useVideoConfig());`))
      .toContain('{&quot;id&quot;:&quot;CaptionVideo&quot;,&quot;width&quot;:1080,&quot;height&quot;:1920,&quot;fps&quot;:30,&quot;durationInFrames&quot;:60}');
  });

  it("evaluation errors report threw", () => {
    const onError = vi.fn();
    expect(buildMotionGraphic("throw new Error('x')", onError)).toBe(MgBroken);
    expect(onError).toHaveBeenLastCalledWith("x");
    expect(buildMotionGraphic("const Component = 42;", onError)).toBe(MgBroken);
    expect(onError).toHaveBeenLastCalledWith("no Component");
    expect(buildMotionGraphic("const Component = (")).toBe(MgBroken);
    expect(renderToStaticMarkup(createElement(MgView, { mg: MgBroken, id: "mg-0", frame: 0, item, config, report: () => {}, track: () => {} }))).toContain("⚠ mg-0");
  });

  it("image props and the logo become blob URLs", () => {
    const blobs = new Map([["http://a/1", "blob:x1"], ["http://a/logo", "blob:logo"]]);
    const out = withBlobUrls({ ...item, props: { photo: "http://a/1", other: "http://a/2", n: 3 }, brand: { ...item.brand, logoUrl: "http://a/logo" } }, blobs);
    expect(out.props).toEqual({ photo: "blob:x1", other: "http://a/2", n: 3 });
    expect(out.brand.logoUrl).toBe("blob:logo");
    expect(withBlobUrls(item, blobs).brand.logoUrl).toBeNull();
  });

  it("motion graphics get the forgiving Img, not Remotion's", async () => {
    const { Img } = await import("remotion");
    expect(MG_SCOPE.Img).not.toBe(Img);
  });

  it("sees only its scope", () => {
    expect(Object.keys(MG_SCOPE)).toEqual(["React", "AbsoluteFill", "Img", "Easing", "interpolate", "interpolateColors", "random", "spring", "useCurrentFrame", "useVideoConfig"]);
    const C = buildMotionGraphic(`const Component = () => React.createElement("i", null, typeof interpolate, typeof spring, typeof module, typeof exports);`);
    expect(renderToStaticMarkup(createElement(C, { item }))).toBe("<i>functionfunctionundefinedundefined</i>");
  });
});
