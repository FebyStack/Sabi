import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Action, BrandKit, Project } from "@shared/types";
import { StylePanel } from "./StylePanel";

const elements: { props: Record<string, unknown> }[] = [];
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const o = await orig<{ jsxDEV: (...a: unknown[]) => unknown }>();
  return { ...o, jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => { elements.push({ props }); return o.jsxDEV(type, props, ...rest); } };
});
vi.mock("./CaptionSample", () => ({ CaptionSample: () => null })); // drawn with Remotion's AbsoluteFill; covered by CaptionBlock

const brand = (palette: Partial<BrandKit["palette"]> = {}): BrandKit =>
  ({ palette: { primary: "#1E90FF", accent: "#FFD60A", text: "#FFFFFF", background: "#0B0B0B", ...palette }, fontFamily: "Montserrat", logoAssetId: null, grade: 0.4 });
const render = (project: Project) => {
  elements.length = 0;
  const commit = vi.fn(async (_: Action[]) => {});
  return { html: renderToStaticMarkup(<StylePanel project={project} commit={commit} busy={false} />), commit };
};

describe("StylePanel", () => {
  it("presets are radios with the current one checked", () => {
    const { html } = render(editorProject({ captionTemplateId: "bold" }));
    expect(html).toContain('role="radiogroup" aria-label="Caption preset"');
    expect(html.match(/role="radio" aria-checked="true"[^>]*aria-label="Preset [^"]+"/g)).toEqual([expect.stringContaining('aria-label="Preset Bold"')]);
    expect(html.match(/aria-label="Preset /g)).toHaveLength(3);
  });

  it("warns when caption contrast is under 3:1", () => {
    expect(render(editorProject({ brand: brand({ text: "#333333", background: "#222222" }) })).html).toMatch(/Caption text is hard to read on this background \(1\.\d:1\)/);
    expect(render(editorProject({ brand: brand() })).html).not.toContain("hard to read");
  });

  it("style controls reflect the project", () => {
    const { html } = render(editorProject({ captionStyle: { sizePx: 96, fontFamily: "Bebas Neue" } }));
    expect(html).toMatch(/<input[^>]*type="range"[^>]*aria-label="Caption size"[^>]*value="96"|<input[^>]*aria-label="Caption size"[^>]*value="96"/);
    expect(html).toMatch(/<option value="Bebas Neue" selected="">/);
    expect(html).toMatch(/aria-label="Caption position"[^>]*value="0.78"/); // unset keys show the preset's value
  });

  it("logo input accepts images only", () => {
    const { html } = render(editorProject({ brand: brand() }));
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
    expect(html).toMatch(/aria-label="Primary"[^>]*type="color"|type="color"[^>]*aria-label="Primary"/);
  });

  it("commits the whole style object", () => {
    const { commit } = render(editorProject({ captionStyle: { sizePx: 96, y: 0.6 } }));
    const upper = elements.find((e) => e.props.label === "Uppercase")!.props.onChange as (on: boolean) => void;
    upper(true);
    expect(commit).toHaveBeenCalledWith([{ type: "setCaptionStyle", style: { sizePx: 96, y: 0.6, uppercase: true } }]);
  });

  it("without a brand it offers one from the preset colours", () => {
    const { html, commit } = render(editorProject());
    expect(html).toContain(">Use brand<");
    (elements.find((e) => e.props.children === "Use brand")!.props.onClick as () => void)();
    expect(commit).toHaveBeenCalledWith([{ type: "setBrand", brand: { palette: { primary: "#FF9F0A", accent: "#FFD60A", text: "#FFFFFF", background: "#000000" }, fontFamily: "Inter", logoAssetId: null, grade: 0 } }]);
  });
});
