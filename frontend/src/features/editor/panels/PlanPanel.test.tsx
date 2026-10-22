import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Action, Project } from "@shared/types";
import { PlanPanel } from "./PlanPanel";

// Record every element's props, so handlers can be called without a DOM.
const elements: { type: unknown; props: Record<string, unknown> }[] = [];
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const o = await orig<{ jsxDEV: (...a: unknown[]) => unknown }>();
  return { ...o, jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => { elements.push({ type, props }); return o.jsxDEV(type, props, ...rest); } };
});

const render = (project: Project) => {
  elements.length = 0;
  const commit = vi.fn(async (_: Action[]) => {});
  const html = renderToStaticMarkup(<PlanPanel project={project} busy={false} onPlan={() => {}} commit={commit} onSeek={() => {}} />);
  return { html, commit };
};
const withProps = (pred: (p: Record<string, unknown>) => boolean) => elements.find((e) => pred(e.props))!.props;

describe("PlanPanel", () => {
  it("cuts toggle through setCut", () => {
    const { html, commit } = render(editorProject());
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Cut pause 0.5 s at 0:02.0"/);
    (withProps((p) => p.label === "Cut “um” at 0:08.0").onChange as (on: boolean) => void)(true);
    expect(commit).toHaveBeenCalledWith([{ type: "setCut", cutId: "cut-1", shouldTrim: true }]);
    expect(html).not.toContain("Apply"); // no draft: every change commits at once
    expect(html).not.toContain('aria-label="Shot at'); // shots live on the timeline now
  });

  it("burn-in commits setBurnIn", () => {
    const { html, commit } = render(editorProject({ translations: [{ language: "es", phrases: [] }] }));
    expect(html).toContain('aria-label="Burn in"');
    (withProps((p) => p["aria-label"] === "Burn in").onChange as (e: { target: { value: string } }) => void)({ target: { value: "es" } });
    expect(commit).toHaveBeenCalledWith([{ type: "setBurnIn", language: "es" }]);
  });

  it("plan form lists languages and burn-in", () => {
    const { html } = render(editorProject({ editPlan: null }));
    expect(html).toContain(">Plan edit<");
    expect(html).toMatch(/aria-pressed="false"[^>]*>Spanish</);
    expect(html).not.toMatch(/>English</); // the transcript's own language
    expect(html).toContain("Translate subtitles (up to 3)");
  });
});
