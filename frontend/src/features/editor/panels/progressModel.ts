import type { ProjectStatus } from "@shared/types";

// The one staged progress model (spec row 5): every job's stages fold onto these five steps.
export const STAGES = ["uploading", "transcribing", "planning", "generating", "rendering"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  uploading: "Uploading", transcribing: "Transcribing", planning: "Planning the edit", generating: "Generating B-roll", rendering: "Rendering",
};

// [job kind, job stages, step, job progress at the start of the step, at its end]
const STEPS: [string, string[], Stage, number, number][] = [
  ["captions", ["extract-audio", "transcribe", "segment"], "transcribing", 0, 60],
  ["plan", ["plan", "translate"], "planning", 0, 70],
  ["broll", ["beats", "label", "fetch"], "generating", 0, 80],
];
const RENDER = ["render", "subtitles"];
const BY_STATUS: Partial<Record<ProjectStatus, Stage>> = { transcribing: "transcribing", planning: "planning", generating: "generating", rendering: "rendering" };

export function stageView(input: { uploadPct: number | null; kind: string | null; stage: string | null; progress: number; status: ProjectStatus | null }): { stage: Stage; pct: number } | null {
  const view = (stage: Stage, pct: number) => ({ stage, pct: Math.round(Math.min(100, Math.max(0, pct))) });
  if (input.uploadPct !== null) return view("uploading", input.uploadPct);
  const { kind, stage, progress } = input;
  if (stage && RENDER.includes(stage)) return view("rendering", ((progress - 60) / 40) * 100);
  const step = STEPS.find(([k, stages]) => k === kind && stage && stages.includes(stage));
  if (step) return view(step[2], ((progress - step[3]) / (step[4] - step[3])) * 100);
  const byStatus = input.status && BY_STATUS[input.status];
  return byStatus ? view(byStatus, 0) : null;
}
