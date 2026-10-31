import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Action, Project, Services } from "@shared/types";
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

const services = (patch: Partial<Services> = {}): Services => ({ whisperx: "ok", ollama: "ok", ollamaModel: "qwen2.5:3b", stock: "ok", generator: "ok", ...patch });
const withServices = (s: Services) => {
  elements.length = 0;
  return renderToStaticMarkup(<PlanPanel project={editorProject({ editPlan: null })} busy={false} onPlan={() => {}} commit={async () => {}} onSeek={() => {}} services={s} />);
};

describe("PlanPanel", () => {
  it("names a missing Ollama model or a stopped Ollama; Plan edit stays enabled", () => {
    expect(withServices(services({ ollama: "model_missing" }))).toContain("Ollama has no qwen2.5:3b — run ollama pull qwen2.5:3b.");
    expect(withProps((p) => p.children === "Plan edit").disabled).toBe(false);
    expect(withServices(services({ ollama: "down" }))).toContain("Ollama isn&#x27;t running — start it with npm run ai:ollama.");
    expect(withServices(services())).not.toContain("Ollama");
  });

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
