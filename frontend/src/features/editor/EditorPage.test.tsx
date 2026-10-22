import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { editorProject } from "@shared/editing/fixtures";
import type { Project } from "@shared/types";
import EditorPage from "./EditorPage";
import { PlanPanel } from "./panels/PlanPanel";
import { initialEditorState, type EditorState } from "./store/editorStore";

// Keys never reach the markup, so record what every JSX call keys.
const keyed: [unknown, string | null][] = [];
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const o = await orig<{ jsxDEV: (...a: unknown[]) => unknown }>();
  return { ...o, jsxDEV: (type: unknown, props: unknown, key: string | undefined, ...rest: unknown[]) => { keyed.push([type, key ?? null]); return o.jsxDEV(type, props, key, ...rest); } };
});
const previewed: Project[] = [];
vi.mock("./panels/CaptionPreview", () => ({ CaptionPreview: ({ project }: { project: Project }) => { previewed.push(project); return null; } })); // the Player needs a DOM
vi.mock("@tanstack/react-query", async (orig) => {
  const o = await orig<typeof import("@tanstack/react-query")>();
  return { ...o, useMutation: vi.fn(o.useMutation) };
});
const initial = vi.hoisted(() => ({ state: {} as Partial<EditorState>, selectors: [] as ((s: EditorState) => unknown)[] }));
vi.mock("./store/editorStore", async (orig) => {
  const o = await orig<typeof import("./store/editorStore")>();
  return {
    ...o, createEditorStore: () => o.createEditorStore(initial.state),
    useEditorStore: (store: Parameters<typeof o.useEditorStore>[0], select: (s: EditorState) => unknown) => { initial.selectors.push(select); return o.useEditorStore(store, select); },
  };
});

const project = editorProject({ id: "A", transcript: { language: "en", words: editorProject().phrases.flatMap((p) => p.words) } });

function page(p: Project, tab = "") {
  const qc = new QueryClient();
  qc.setQueryData(["project", p.id], p);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/p/${p.id}${tab && `?tab=${tab}`}`]}><Routes><Route path="/p/:id" element={<EditorPage />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EditorPage", () => {
  beforeEach(() => { keyed.length = 0; previewed.length = 0; initial.state = {}; initial.selectors.length = 0; vi.mocked(useMutation).mockReset(); });

  it("keys the plan panel by project id, so its draft state resets on /p/A → /p/B", () => {
    page(project, "broll");
    expect(keyed).toContainEqual([PlanPanel, "A"]);
  });

  it("shows a failed plan request in the Failed line", () => {
    vi.mocked(useMutation).mockReturnValue({ error: new Error("busy"), isPending: false, mutate: () => {} } as never);
    expect(page(project)).toContain("Failed: busy");
  });

  it("a conflict shows a retry notice", () => {
    initial.state = { conflict: { actions: [{ type: "setTitle", title: "x" }], message: "Project changed elsewhere — reloaded" } };
    const html = page(project);
    expect(html).toContain("Project changed elsewhere — reloaded");
    expect(html).toContain(">Retry</button>");
    // on a phone the notice floats above the tab bar, so a conflict is never below the fold
    expect(html).toMatch(/<div data-toasts="" class="fixed [^"]*lg:static[^"]*">.*Project changed elsewhere/s);
  });

  it("drag preview patches the preview project", () => {
    initial.state = { drag: { actions: [{ type: "setOverlay", overlayId: "ov-0", endMs: 11000 }] } };
    page(project);
    expect(previewed.at(-1)!.overlays[0].endMs).toBe(11000);
  });

  it("renders the timeline, tabs and the b-roll panel once a plan exists", () => {
    const html = page(project, "broll");
    expect(html).toContain("Refresh B-roll");
    expect(html).toContain('aria-label="Timeline"');
    expect(html).toContain('aria-label="Editor sections"');
  });

  it("a selection shows the selection bar", () => {
    initial.state = { selection: { kind: "shot", id: "shot-1" } };
    expect(page(project)).toContain('aria-label="Shot kind"');
  });

  it("playback re-renders only what draws the playhead", () => {
    page(project);
    const a = { ...initialEditorState, selection: { kind: "shot" as const, id: "shot-1" }, undo: [], drag: null };
    const b = { ...a, playheadMs: 4321 };
    expect(initial.selectors.length).toBeGreaterThan(3);
    for (const select of initial.selectors) expect(Object.is(select(a), select(b)) || select(b) === 4321).toBe(true);
  });
});
