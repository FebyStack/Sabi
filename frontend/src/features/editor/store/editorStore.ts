import { useSyncExternalStore } from "react";
import type { Action } from "@shared/types";

// Editor-only state beside the project query (which stays the source of truth). One store per EditorPage mount.
export type Selected = { kind: "shot" | "cut" | "phrase" | "overlay" | "mg"; id: string };
export type DragPreview = { actions: Action[] }; // applied with applyLocal for the Player while dragging
export type Conflict = { actions: Action[]; message: string };
export type UndoEntry = { forward: Action[]; inverse: Action[] };
export type EditorState = {
  selection: Selected | null; playheadMs: number; zoom: number; drag: DragPreview | null;
  undo: UndoEntry[]; redo: UndoEntry[]; conflict: Conflict | null;
  changed: { ids: string[]; at: number } | null; notice: string | null;
  deleting: boolean; // the selection bar's "Delete?" confirm is open (Delete/Backspace on a focused layer)
};
export type EditorStore = ReturnType<typeof createEditorStore>;

export const initialEditorState: EditorState = {
  selection: null, playheadMs: 0, zoom: 1, drag: null, undo: [], redo: [], conflict: null, changed: null, notice: null, deleting: false,
};

export function createEditorStore(initial: Partial<EditorState> = {}) {
  const start = { ...initialEditorState, ...initial };
  let state = start;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      listeners.forEach((l) => l());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    reset() {
      state = start;
      listeners.forEach((l) => l());
    },
  };
}

export function useEditorStore<T>(store: EditorStore, select: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}
