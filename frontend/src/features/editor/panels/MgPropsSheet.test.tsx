import { renderToStaticMarkup } from "react-dom/server";
import type { Action, MotionGraphic } from "@shared/types";
import { MgPropsSheet, propLabel, syncDraft } from "./MgPropsSheet";

const elements: { props: Record<string, unknown> }[] = [];
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const o = await orig<{ jsxDEV: (...a: unknown[]) => unknown }>();
  return { ...o, jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => { elements.push({ props }); return o.jsxDEV(type, props, ...rest); } };
});
const upload = vi.hoisted(() => ({ file: vi.fn() }));
vi.mock("@/features/projects/api/projects", async (orig) => ({ ...(await orig<typeof import("@/features/projects/api/projects")>()), uploadFile: upload.file }));

const mg: MotionGraphic = {
  id: "mg-0", name: "Stat", code: "", compiled: "", startMs: 0, endMs: 2000, box: { x: 0, y: 0, w: 1, h: 1 }, enabled: true,
  props: [
    { key: "value", type: "number", value: 2 },
    { key: "unitLabel", type: "text", value: "hours" },
    { key: "accent", type: "color", value: "#FFD60A" },
    { key: "showBar", type: "boolean", value: true },
    { key: "photo", type: "image", value: "a-1" },
  ],
};
const render = () => {
  elements.length = 0;
  const commit = vi.fn(async (_: Action[]) => {});
  const html = renderToStaticMarkup(<MgPropsSheet mg={mg} projectId="p" busy={false} commit={commit} onClose={() => {}} />);
  return { html, commit };
};
const named = (name: string) => elements.find((e) => e.props.name === name)!.props;
const withValue = (key: string, value: string | number | boolean) => mg.props.map((p) => (p.key === key ? { ...p, value } : p)) as MotionGraphic["props"];

describe("MgPropsSheet (spec row 25: the web edits MG props)", () => {
  afterEach(() => vi.useRealTimers());

  it("labels each prop from its key", () => {
    expect(propLabel("unitLabel")).toBe("Unit label");
    expect(propLabel("value")).toBe("Value");
    expect(propLabel("showBar")).toBe("Show bar");
  });

  it("one labelled field per prop", () => {
    const { html } = render();
    for (const label of [">Value<", ">Unit label<", ">Accent<", ">Photo<"]) expect(html).toContain(label);
    expect(html).toContain('value="#ffd60a"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('src="/api/assets/a-1/file"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain('aria-label="Show bar"');
  });

  it("a text edit commits the whole props array after 300 ms", () => {
    vi.useFakeTimers();
    const { commit } = render();
    (named("unitLabel").onChange as (e: { target: { value: string } }) => void)({ target: { value: "of sleep" } });
    vi.advanceTimersByTime(299);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledWith([{ type: "updateMotionGraphic", mgId: "mg-0", props: withValue("unitLabel", "of sleep") }]);
  });

  it("its own commits coming back keep what was typed since; any other change replaces the draft", () => {
    const first = withValue("unitLabel", "hours of");
    const typed = withValue("unitLabel", "hours of sleep"); // typed (and sent) while "hours of" was in flight
    expect(syncDraft(typed, first, [first, typed])).toEqual({ draft: typed, ours: [first, typed] });
    expect(syncDraft(typed, typed, [first, typed])).toEqual({ draft: typed, ours: [typed] });
    const agent = withValue("value", 5); // the agent changed the MG meanwhile: its props win
    expect(syncDraft(typed, agent, [first, typed])).toEqual({ draft: agent, ours: [] });
  });

  it("a switch commits at once", () => {
    const { commit } = render();
    (elements.find((e) => e.props.label === "Show bar")!.props.onChange as (on: boolean) => void)(false);
    expect(commit).toHaveBeenCalledWith([{ type: "updateMotionGraphic", mgId: "mg-0", props: withValue("showBar", false) }]);
  });

  it("an uploaded image commits its asset id", async () => {
    upload.file.mockResolvedValueOnce({ id: "a-9" });
    const { commit } = render();
    await (named("photo").onChange as (e: { target: { files: File[] } }) => Promise<void>)({ target: { files: [new File(["x"], "x.png", { type: "image/png" })] } });
    expect(commit).toHaveBeenCalledWith([{ type: "updateMotionGraphic", mgId: "mg-0", props: withValue("photo", "a-9") }]);
    upload.file.mockRejectedValueOnce(new Error("offline"));
    const again = render();
    await (named("photo").onChange as (e: { target: { files: File[] } }) => Promise<void>)({ target: { files: [new File(["x"], "x.png", { type: "image/png" })] } });
    expect(again.commit).not.toHaveBeenCalled();
  });
});
