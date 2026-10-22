import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Action, Project } from "@shared/types";
import { applyProjectActions } from "@/features/projects/api/projects";
import { createEditorStore } from "../store/editorStore";
import { AGENT_NOTICE, noteExternalChange, useProjectActions } from "./useProjectActions";

vi.mock("@/features/projects/api/projects", () => ({ applyProjectActions: vi.fn(), getProject: vi.fn(() => new Promise(() => {})) }));
const post = vi.mocked(applyProjectActions);

function setup(project: Project = editorProject()) {
  const qc = new QueryClient();
  qc.setQueryData(["project", project.id], project);
  const store = createEditorStore();
  let api!: ReturnType<typeof useProjectActions>;
  const Probe = () => { api = useProjectActions(project.id, store); return null; };
  renderToStaticMarkup(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
  const cached = () => qc.getQueryData<Project>(["project", project.id])!;
  return { qc, store, api, cached };
}
const saved = (p: Project, updatedAt: string) => ({ project: { ...p, updatedAt }, applied: 1 });
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const nudge: Action[] = [{ type: "setOverlay", overlayId: "ov-0", endMs: 8000 }];

describe("useProjectActions", () => {
  beforeEach(() => post.mockReset());

  it("optimistic patch lands in the cache before the request resolves", async () => {
    const { api, cached } = setup();
    const res = deferred<ReturnType<typeof saved>>();
    post.mockReturnValueOnce(res.promise as never);
    const done = api.commit(nudge);
    expect(cached().overlays[0].endMs).toBe(8000);
    expect(post).toHaveBeenCalledWith("p1", { baseVersion: "v1", actions: nudge, render: false });
    res.resolve(saved({ ...cached() }, "v2"));
    await done;
    expect(cached()).toMatchObject({ updatedAt: "v2", overlays: [{ endMs: 8000 }] });
  });

  it("a stale commit rolls back the optimistic patch and offers retry", async () => {
    const { qc, store, api, cached } = setup();
    const before = cached();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    post.mockRejectedValueOnce(new Error("stale"));
    await api.commit(nudge);
    expect(cached()).toEqual(before);
    expect(store.get().conflict).toEqual({ actions: nudge, message: "Project changed elsewhere — reloaded" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project", "p1"] });
    expect(store.get().undo).toEqual([]);
  });

  it("retry re-sends the same actions on the new baseVersion", async () => {
    const { qc, store, api } = setup();
    post.mockRejectedValueOnce(new Error("stale"));
    await api.commit(nudge);
    qc.setQueryData(["project", "p1"], editorProject({ updatedAt: "v2", title: "Agent" })); // the refetch brought the agent's edit
    post.mockResolvedValueOnce(saved(editorProject(), "v3") as never);
    await api.retry();
    expect(post.mock.calls[1]).toEqual(["p1", { baseVersion: "v2", actions: nudge, render: false }]);
    expect(store.get().conflict).toBeNull();
  });

  it("undo commits the inverse and fills redo", async () => {
    const { store, api } = setup();
    post.mockResolvedValueOnce(saved(editorProject({ title: "New" }), "v2") as never);
    await api.commit([{ type: "setTitle", title: "New" }]);
    expect(store.get().undo).toEqual([{ forward: [{ type: "setTitle", title: "New" }], inverse: [{ type: "setTitle", title: "Morning" }] }]);
    post.mockResolvedValueOnce(saved(editorProject(), "v3") as never);
    await api.undo();
    expect(post.mock.calls[1]).toEqual(["p1", { baseVersion: "v2", actions: [{ type: "setTitle", title: "Morning" }], render: false }]);
    expect(store.get()).toMatchObject({ undo: [], redo: [{ forward: [{ type: "setTitle", title: "New" }] }] });
    post.mockResolvedValueOnce(saved(editorProject({ title: "New" }), "v4") as never);
    await api.redo();
    expect(post.mock.calls[2][1].actions).toEqual([{ type: "setTitle", title: "New" }]);
    expect(store.get()).toMatchObject({ undo: [{ inverse: [{ type: "setTitle", title: "Morning" }] }], redo: [] });
  });

  it("quick successive commits go out one at a time, each on the version the previous one produced", async () => {
    const { store, api, cached } = setup();
    const first = deferred<ReturnType<typeof saved>>();
    post.mockReturnValueOnce(first.promise as never).mockResolvedValueOnce(saved(editorProject(), "v3") as never);
    const c1 = api.commit([{ type: "setOverlay", overlayId: "ov-0", endMs: 8500 }]);
    const c2 = api.commit([{ type: "setOverlay", overlayId: "ov-0", endMs: 8000 }]); // a double tap, before the first answer
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
    first.resolve(saved({ ...cached(), overlays: [{ ...cached().overlays[0], endMs: 8500 }] }, "v2"));
    await Promise.all([c1, c2]);
    expect(post.mock.calls.map(([, body]) => body.baseVersion)).toEqual(["v1", "v2"]);
    expect(store.get().conflict).toBeNull();
    expect(cached().updatedAt).toBe("v3");
  });

  it("refused and busy edits restore the cache and explain", async () => {
    const { store, api, cached } = setup();
    post.mockRejectedValueOnce(new Error("busy"));
    await api.commit(nudge);
    expect(store.get().notice).toBe("A job is running — wait for it to finish");
    expect(cached().overlays[0].endMs).toBe(9000);
    post.mockRejectedValueOnce(new Error("out_of_shot"));
    await api.commit(nudge);
    expect(store.get().notice).toBe("Edit refused: out_of_shot");
    await api.commit([{ type: "setOverlay", overlayId: "ov-0", endMs: 99999 }]); // refused locally, never sent
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("an external version clears undo and names the changed layers", () => {
    const store = createEditorStore({ undo: [{ forward: [], inverse: [] }], redo: [{ forward: [], inverse: [] }] });
    const prev = editorProject();
    const next = editorProject({ updatedAt: "v9", overlays: [{ ...prev.overlays[0], endMs: 7000 }] });
    expect(noteExternalChange(store, prev, next, new Set(["v2"]))).toBe(true);
    expect(store.get()).toMatchObject({ undo: [], redo: [], notice: AGENT_NOTICE, changed: { ids: ["ov-0"] } });
    const mine = createEditorStore({ undo: [{ forward: [], inverse: [] }] });
    expect(noteExternalChange(mine, prev, { ...next, updatedAt: "v2" }, new Set(["v2"]))).toBe(false);
    expect(noteExternalChange(mine, prev, { ...prev }, new Set())).toBe(false); // same version (an optimistic patch)
    expect(mine.get().undo).toHaveLength(1);
  });
});
