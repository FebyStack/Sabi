import { brollJob } from "../modules/broll/job";
import { planJob } from "../modules/editplan/routes";
import { generateJob } from "../modules/generate/job";
import { captionJob } from "../modules/pipeline/pipeline";
import type { ProjectStatus } from "../../shared/types";
import type { AppDeps } from "../shared/deps";
import type { JobHandler } from "../shared/jobs";

const RUNNING: ProjectStatus[] = ["transcribing", "planning", "generating", "rendering"];

// A job that spends fal credits never runs twice: a second start (the API died mid-job and the queue brought it back)
// puts the project back as it was, marks the MP4 stale (the job may have changed what it shows) and fails "interrupted".
export const noRerun = (deps: AppDeps, handler: JobHandler): JobHandler => async (ctx) => {
  if (ctx.attempt <= 1) return handler(ctx);
  const p = await deps.projects.get(ctx.projectId);
  if (p) {
    const updated = await deps.projects.update(p.id, {
      ...(RUNNING.includes(p.status) ? { status: ctx.data.prevStatus } : {}),
      ...(p.outputs.mp4AssetId ? { outputs: { ...p.outputs, stale: true } } : {}),
    });
    deps.bus.publish(p.id, { type: "project", status: updated.status });
  }
  throw new Error("interrupted");
};

// Every job kind and the handler that runs it; createApp registers them before any route can enqueue.
// captions and plan are free to redo after a restart; broll and generate spend money, so they are not.
export function registerJobHandlers(deps: AppDeps): void {
  deps.jobs.handle("captions", captionJob(deps));
  deps.jobs.handle("plan", planJob(deps));
  deps.jobs.handle("broll", noRerun(deps, brollJob(deps)));
  deps.jobs.handle("generate", noRerun(deps, generateJob(deps)));
}
