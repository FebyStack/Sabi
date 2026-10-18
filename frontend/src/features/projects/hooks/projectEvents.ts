import type { ProjectEvent, ProjectStatus } from "@shared/types";

export type EventsState = { status: ProjectStatus | null; stage: string | null; progress: number; error: string | null };

export const initialEventsState: EventsState = { status: null, stage: null, progress: 0, error: null };

export function reduceProjectEvents(state: EventsState, e: ProjectEvent): EventsState {
  if (e.type === "project") return { ...state, status: e.status };
  const { job } = e;
  switch (job.state) {
    case "QUEUED": return { ...state, stage: null, progress: 0, error: null };
    case "PROCESSING": return { ...state, stage: job.stage ?? state.stage, progress: job.progress, error: null };
    case "COMPLETE": return { ...state, progress: 100 };
    case "FAILED": return { ...state, error: job.error ?? "failed" };
  }
}
