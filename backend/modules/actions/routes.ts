import { Router } from "express";
import { ApplyActionsInput, api } from "../../../shared/contract";
import type { AppDeps } from "../../shared/deps";
import { projectLoader } from "../../shared/routes";
import { StaleVersion } from "../projects/repository";
import { startCaptionJob } from "../pipeline/pipeline";
import { applyActions } from "./apply";

// The agent's write path: one atomic batch guarded by optimistic concurrency (baseVersion = updatedAt it last saw).
export function actionsRouter(deps: AppDeps) {
  const r = Router();
  const load = projectLoader(deps);

  r.post<{ id: string }>(api.projectActions(":id"), async (req, res) => {
    const parsed = ApplyActionsInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    const project = await load(req, res);
    if (!project) return;
    const { baseVersion, actions, render } = parsed.data;
    if (baseVersion !== project.updatedAt) return res.status(409).json({ error: "stale", currentVersion: project.updatedAt });
    const job = deps.jobs.active(project.id);
    if (job) return res.status(409).json({ error: "busy", job });
    const out = applyActions(project, actions);
    if ("error" in out) return res.status(400).json(out);

    let updated;
    try {
      updated = await deps.projects.update(project.id, out.patch, { ifVersion: baseVersion }); // atomic with the check above
    } catch (err) {
      if (err instanceof StaleVersion) return res.status(409).json({ error: "stale", currentVersion: err.currentVersion });
      throw err;
    }
    deps.bus.publish(project.id, { type: "project", status: updated.status }); // open web tabs refetch, so a later web edit starts from Claude's
    if (!render || !out.rerender) return res.json({ project: updated, applied: actions.length });
    const started = startCaptionJob(deps, updated, { transcribe: false, resegment: false });
    res.status(202).json({ project: updated, applied: actions.length, jobId: started.id });
  });

  return r;
}
