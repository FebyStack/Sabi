import { createEditorStore, initialEditorState } from "./editorStore";

describe("editor store", () => {
  it("set, subscribe and reset", () => {
    const store = createEditorStore({ zoom: 2 });
    expect(store.get()).toEqual({ ...initialEditorState, zoom: 2 });
    expect(initialEditorState).toMatchObject({ zoom: 1, playheadMs: 0, selection: null, undo: [], redo: [], conflict: null });
    const seen: number[] = [];
    const off = store.subscribe(() => seen.push(store.get().playheadMs));
    store.set({ playheadMs: 500 });
    store.set((s) => ({ playheadMs: s.playheadMs + 100, selection: { kind: "overlay", id: "ov-0" } }));
    expect(seen).toEqual([500, 600]);
    expect(store.get().selection).toEqual({ kind: "overlay", id: "ov-0" });
    off();
    store.set({ playheadMs: 1 });
    expect(seen).toHaveLength(2);
    store.reset();
    expect(store.get()).toEqual({ ...initialEditorState, zoom: 2 });
  });
});
