import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCaptionTemplate } from "../captions/templates";
import { templateLook } from "../editing/brand";
import { MgBroken, buildMotionGraphic, type MgItem } from "./mgRuntime";

const item: MgItem = { props: { title: "42% faster" }, brand: templateLook(getCaptionTemplate("clean")), width: 1080, height: 960, durationInFrames: 60 };

describe("mgRuntime", () => {
  it("builds a component from compiled code", () => {
    const C = buildMotionGraphic(`const Component = ({ item }) => React.createElement("div", null, item.props.title, " ", item.brand.accent);`);
    expect(typeof C).toBe("function");
    expect(C).not.toBe(MgBroken);
    expect(renderToStaticMarkup(createElement(C, { item }))).toBe("<div>42% faster #FFD60A</div>");
  });

  it("an evaluation error yields the broken placeholder component", () => {
    expect(buildMotionGraphic("throw new Error('x')")).toBe(MgBroken);
    expect(buildMotionGraphic("const Component = 42;")).toBe(MgBroken);
    expect(buildMotionGraphic("const Component = (")).toBe(MgBroken);
    expect(renderToStaticMarkup(createElement(MgBroken, { item }))).toContain("⚠");
  });

  it("caches by source", () => {
    const code = `const Component = () => null;`;
    expect(buildMotionGraphic(code)).toBe(buildMotionGraphic(code));
  });

  it("sees only its scope", () => {
    const C = buildMotionGraphic(`const Component = () => React.createElement("i", null, typeof interpolate, typeof spring, typeof module, typeof exports);`);
    expect(renderToStaticMarkup(createElement(C, { item }))).toBe("<i>functionfunctionundefinedundefined</i>");
  });
});
