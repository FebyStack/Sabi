import { Router } from "express";
import { BrollInput, api } from "../../../shared/contract";
import type { AppDeps } from "../../shared/deps";
import { projectLoader } from "../../shared/routes";
import { startBrollJob } from "./job";

// The only B-roll write that is not an action: fetching media is network work, so it is a job.
export function brollRouter(deps: AppDeps) {
  const r = Router();
  const load = projectLoader(deps);

  r.post<{ id: string }>(api.projectBroll(":id"), async (req, res) => {
    const parsed = BrollInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    const project = await load(req, res);
    if (!project) return;
    if (!project.editPlan) return res.status(400).json({ error: "no_plan" });
    const { overlayId } = parsed.data;
    if (overlayId && !project.overlays.some((o) => o.id === overlayId)) return res.status(400).json({ error: "unknown_id", id: overlayId });
    if (deps.jobs.active(project.id)) return res.status(409).json({ error: "busy" });
    res.status(202).json({ jobId: startBrollJob(deps, project, parsed.data).id });
  });

  return r;
}
