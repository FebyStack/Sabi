import type { ProjectEvent, ProjectStatus } from "@shared/types";

// running: a job is queued or processing (a generate job changes no status, so this is how the editor knows it is busy).
export type EventsState = {
  status: ProjectStatus | null; kind: string | null; stage: string | null; progress: number; error: string | null; running: boolean; queued: boolean;
};

export const initialEventsState: EventsState = { status: null, kind: null, stage: null, progress: 0, error: null, running: false, queued: false };

export function reduceProjectEvents(state: EventsState, e: ProjectEvent): EventsState {
  if (e.type === "project") return { ...state, status: e.status };
  const { job } = e;
  switch (job.state) {
    case "QUEUED": return { ...state, kind: job.kind, stage: null, progress: 0, error: null, running: true, queued: true };
    case "PROCESSING": return { ...state, kind: job.kind, stage: job.stage ?? state.stage, progress: job.progress, error: null, running: true, queued: false };
    case "COMPLETE": return { ...state, progress: 100, running: false, queued: false };
    case "FAILED": return { ...state, error: job.error ?? "failed", running: false, queued: false };
  }
}

const ERRORS: Record<string, string> = {
  interrupted: "Interrupted by a restart — run it again.",
  over_cap: "Monthly spending cap reached — see Usage.",
};
export const jobErrorText = (error: string) => ERRORS[error] ?? error;
