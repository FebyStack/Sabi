import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { applyLocal, isLocalAction } from "@shared/editing/applyLocal";
import type { Action, Project, ProjectStatus } from "@shared/types";
import { applyProjectActions, getProject } from "@/features/projects/api/projects";
import type { EditorStore } from "../store/editorStore";
import { changedIds, isExternal } from "./externalChange";
import { inverseActions } from "./inverse";

export const AGENT_NOTICE = "Edited by the agent";
export const CONFLICT_MESSAGE = "Project changed elsewhere — reloaded";
const RUNNING: ProjectStatus[] = ["transcribing", "planning", "generating", "rendering"];

// A new version this tab did not write: pulse what changed and drop undo (undoing would fight the other editor).
// A job's own write (plan, B-roll) pulses too, without claiming the agent did it. True when it was external.
export function noteExternalChange(store: EditorStore, prev: Project | undefined, next: Project, own: Set<string>): boolean {
  if (!prev || prev.updatedAt === next.updatedAt || !isExternal(next, own)) return false;
  const ids = changedIds(prev, next);
  if (!ids.length) return false; // status / outputs only (a render finished)
  const byJob = RUNNING.includes(prev.status) || RUNNING.includes(next.status);
  store.set({ changed: { ids, at: Date.now() }, undo: [], redo: [], ...(byJob ? {} : { notice: AGENT_NOTICE }) });
  return true;
}

// The web app's one write path: typed actions on POST …/actions with render: false, optimistic when the fold is local.
export function useProjectActions(projectId: string, store: EditorStore) {
  const qc = useQueryClient();
  const key = ["project", projectId];
  const own = useRef(new Set<string>());
  const [pending, setPending] = useState(0);
  const { data } = useQuery({ queryKey: key, queryFn: () => getProject(projectId) });
  const seen = useRef<Project | undefined>(undefined);
  const queue = useRef<Promise<unknown> | null>(null); // the last batch still in flight

  useEffect(() => {
    if (!data) return;
    const external = noteExternalChange(store, seen.current, data, own.current);
    seen.current = data;
    if (!external) return;
    const t = setTimeout(() => store.get().notice === AGENT_NOTICE && store.set({ notice: null }), 4000);
    return () => clearTimeout(t);
  }, [data, store]);

  // One batch at a time: each reads the version the previous one produced (a double tap is never its own conflict).
  // Nothing in flight → at once, so the optimistic patch lands this tick.
  const send = (actions: Action[], undoable: boolean): Promise<boolean> => {
    const next = queue.current ? queue.current.then(() => sendNow(actions, undoable)) : sendNow(actions, undoable);
    const settled = next.catch(() => false).finally(() => { if (queue.current === settled) queue.current = null; });
    queue.current = settled;
    return next;
  };
  // Sends one batch; true when the server took it.
  const sendNow = async (actions: Action[], undoable: boolean): Promise<boolean> => {
    const prev = qc.getQueryData<Project>(key);
    if (!prev) return false;
    if (actions.every(isLocalAction)) {
      const local = applyLocal(prev, actions);
      if ("error" in local) { store.set({ notice: `Edit refused: ${local.error}` }); return false; }
      qc.setQueryData(key, local.project);
    }
    const inverse = undoable ? inverseActions(prev, actions) : null;
    setPending((n) => n + 1);
    try {
      const result = await applyProjectActions(projectId, { baseVersion: prev.updatedAt, actions, render: false });
      own.current.add(result.project.updatedAt);
      qc.setQueryData(key, result.project);
      store.set((s) => ({ notice: null, ...(inverse ? { undo: [...s.undo, { forward: actions, inverse }], redo: [] } : {}) }));
      return true;
    } catch (e) {
      const error = (e as Error).message;
      qc.setQueryData(key, prev);
      if (error === "stale") {
        qc.invalidateQueries({ queryKey: key });
        store.set({ conflict: { actions, message: CONFLICT_MESSAGE } });
      } else store.set({ notice: error === "busy" ? "A job is running — wait for it to finish" : `Edit refused: ${error}` });
      return false;
    } finally {
      setPending((n) => n - 1);
    }
  };

  const commit = async (actions: Action[], opts: { undoable?: boolean } = {}) => { await send(actions, opts.undoable !== false); };
  const retry = async () => {
    const c = store.get().conflict;
    if (!c) return;
    store.set({ conflict: null }); // a second stale answer sets a fresh conflict
    await send(c.actions, true);
  };
  const undo = async () => {
    const e = store.get().undo.at(-1);
    if (!e) return;
    store.set((s) => ({ undo: s.undo.slice(0, -1) }));
    if (await send(e.inverse, false)) store.set((s) => ({ redo: [...s.redo, e] }));
  };
  const redo = async () => {
    const e = store.get().redo.at(-1);
    if (!e) return;
    store.set((s) => ({ redo: s.redo.slice(0, -1) }));
    if (await send(e.forward, false)) store.set((s) => ({ undo: [...s.undo, e] }));
  };

  return { commit, undo, redo, retry, dismissConflict: () => store.set({ conflict: null }), pending: pending > 0 };
}
