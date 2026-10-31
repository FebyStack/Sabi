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
  already_ran: "It ran, but a restart lost its result — check the B-roll before running it again.",
  over_cap: "Monthly spending cap reached — see Usage.",
  generator_unavailable: "fal.ai isn't set up: add FAL_KEY to the API, or switch B-roll to Stock only.",
  stock_unavailable: "Pexels isn't set up: add PEXELS_KEY to the API.",
  generator_timeout: "fal.ai took too long; the attempt was still charged. Try again, or use stock.",
  disk_low: "Not enough free disk for a render — free 2 GB on this Mac (npm run doctor).",
  transcriber_unavailable: "whisperX isn't running — start it with npm run ai:whisperx.",
  transcriber_timeout: "whisperX took too long (30 min) — try a shorter clip or check the sidecar's log.",
  transcriber_rejected: "whisperX refused the spoken language — pick another in Spoken language.",
  llm_unavailable: "Ollama isn't running — start it with npm run ai:ollama.",
  llm_timeout: "Ollama took too long (10 min) — try again or a smaller model.",
  llm_model_missing: "Ollama has no model to run — ollama pull the OLLAMA_MODEL.",
  llm_invalid_output: "Ollama's answer never fit the plan format — run Plan edit again.",
};
export const jobErrorText = (error: string) => ERRORS[error] ?? error;
