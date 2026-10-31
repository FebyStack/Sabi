import { brollJob } from "../modules/broll/job";
import { planJob } from "../modules/editplan/routes";
import { generateJob } from "../modules/generate/job";
import { captionJob } from "../modules/pipeline/pipeline";
import type { ProjectStatus } from "../../shared/types";
import type { AppDeps } from "../shared/deps";
import type { JobHandler } from "../shared/jobs";

const RUNNING: ProjectStatus[] = ["transcribing", "planning", "generating", "rendering"];

// A job that died mid-run left its running status: put the previous one back and mark the MP4 stale (the job may have
// changed what it shows). False when the project isn't running, i.e. the job's own handler already put it back.
async function putBack(deps: AppDeps, projectId: string, prevStatus: ProjectStatus): Promise<boolean> {
  const p = await deps.projects.get(projectId);
  if (!p || !RUNNING.includes(p.status)) return false;
  const updated = await deps.projects.update(p.id, { status: prevStatus, ...(p.outputs.mp4AssetId ? { outputs: { ...p.outputs, stale: true } } : {}) });
  deps.bus.publish(p.id, { type: "project", status: updated.status });
  return true;
}

// A job that spends fal credits never runs twice: a second start (the API died mid-job and the queue brought it back)
// puts the project back and fails "interrupted". A project that isn't running any more means the first attempt finished
// and only its result was lost (BullMQ lost the job's lock): nothing to undo, and "run it again" would charge twice.
export const noRerun = (deps: AppDeps, handler: JobHandler): JobHandler => async (ctx) => {
  if (ctx.attempt <= 1) return handler(ctx);
  throw new Error((await putBack(deps, ctx.projectId, ctx.data.prevStatus)) ? "interrupted" : "already_ran");
};

// Every job kind and the handler that runs it; createApp registers them before any route can enqueue.
// captions and plan are free to redo after a restart; broll and generate spend money, so they are not.
export function registerJobHandlers(deps: AppDeps): void {
  deps.jobs.handle("captions", captionJob(deps));
  deps.jobs.handle("plan", planJob(deps));
  deps.jobs.handle("broll", noRerun(deps, brollJob(deps)));
  deps.jobs.handle("generate", noRerun(deps, generateJob(deps)));
  deps.jobs.onAbandoned?.(async (projectId, data) => { await putBack(deps, projectId, data.prevStatus); });
}
