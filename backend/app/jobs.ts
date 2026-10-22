import { brollJob } from "../modules/broll/job";
import { planJob } from "../modules/editplan/routes";
import { captionJob } from "../modules/pipeline/pipeline";
import type { AppDeps } from "../shared/deps";

// Every job kind and the handler that runs it; createApp registers them before any route can enqueue.
export function registerJobHandlers(deps: AppDeps): void {
  deps.jobs.handle("captions", captionJob(deps));
  deps.jobs.handle("plan", planJob(deps));
  deps.jobs.handle("broll", brollJob(deps));
}
