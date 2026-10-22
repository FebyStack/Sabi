import type { Request, Response } from "express";
import { ACTOR_HEADER } from "../../shared/contract";
import type { Actor, JobState } from "../../shared/types";
import type { AppDeps } from "./deps";
import { JobBusy } from "./jobs";

// Loads `:id`; answers 404 and returns undefined when the project does not exist.
export const projectLoader = (deps: AppDeps) => async (req: Request<{ id: string }>, res: Response) => {
  const project = await deps.projects.get(req.params.id);
  if (!project) res.status(404).json({ error: "not_found" });
  return project;
};

// The MCP client marks its requests; everything else is the web app. Attribution for the ledger, not auth.
export const actorOf = (req: Request): Actor => (req.get(ACTOR_HEADER) === "agent" ? "agent" : "web");

// 202 { jobId }, or 409 busy when the project already has a queued or running job (the runner checks atomically).
export async function startJob(res: Response, start: () => Promise<JobState>) {
  try {
    res.status(202).json({ jobId: (await start()).id });
  } catch (err) {
    if (!(err instanceof JobBusy)) throw err;
    res.status(409).json({ error: "busy", job: err.job });
  }
}
