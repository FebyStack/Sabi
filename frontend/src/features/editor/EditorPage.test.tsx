import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { EditPlanPanel } from "./panels/EditPlanPanel";
import EditorPage from "./EditorPage";
import type { Project } from "@shared/types";

// Keys never reach the markup, so record what every JSX call keys.
const keyed: [unknown, string | null][] = [];
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const o = await orig<{ jsxDEV: (...a: unknown[]) => unknown }>();
  return { ...o, jsxDEV: (type: unknown, props: unknown, key: string | undefined, ...rest: unknown[]) => { keyed.push([type, key ?? null]); return o.jsxDEV(type, props, key, ...rest); } };
});
vi.mock("./panels/CaptionPreview", () => ({ CaptionPreview: () => null })); // Remotion's Player needs a DOM
vi.mock("@tanstack/react-query", async (orig) => {
  const o = await orig<typeof import("@tanstack/react-query")>();
  return { ...o, useMutation: vi.fn(o.useMutation) };
});

const word = { id: "w", text: "Hi", startMs: 0, endMs: 500 };
const project = {
  id: "A", title: "t", status: "ready", sourceAssetId: "src", sourceDurationMs: 1000, captionTemplateId: "clean", language: "en",
  transcript: { language: "en", words: [word] }, phrases: [{ id: "p", startMs: 0, endMs: 500, words: [word], lineBreaksAfter: [] }],
  outputs: {}, warnings: [], editPlan: { cuts: [], shots: [{ id: "shot-0", kind: "Hook", startMs: 0, endMs: 1000 }] }, translations: [], burnInLanguage: null,
  mediaSource: "generate", overlays: [], motionGraphics: [], creditsUsedCents: 0, brand: null, updatedAt: "v1",
} as unknown as Project;

function page(p: Project) {
  const qc = new QueryClient();
  qc.setQueryData(["project", p.id], p);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/p/${p.id}`]}><Routes><Route path="/p/:id" element={<EditorPage />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EditorPage", () => {
  beforeEach(() => { keyed.length = 0; vi.mocked(useMutation).mockReset(); });

  it("keys the edit plan panel by project id, so its draft state resets on /p/A → /p/B", () => {
    page(project);
    expect(keyed).toContainEqual([EditPlanPanel, "A"]);
  });

  it("shows a failed plan request in the Failed line", () => {
    vi.mocked(useMutation).mockReturnValue({ error: new Error("busy"), isPending: false, mutate: () => {} } as never);
    expect(page(project)).toContain("Failed: busy");
  });

  it("a stale action refetches and explains", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    page(project);
    const opts = vi.mocked(useMutation).mock.calls.map(([o]) => o as { onError?: (e: Error) => void }).find((o) => o.onError);
    expect(opts).toBeTruthy();
    opts!.onError!(new Error("stale"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project", "A"] });
    invalidate.mockRestore();
  });

  it("renders the b-roll panel once a plan exists", () => {
    expect(page(project)).toContain("Add B-roll");
  });
});
