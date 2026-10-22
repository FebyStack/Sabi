import { Router } from "express";
import { GenerateInput, api } from "../../../shared/contract";
import type { AppDeps } from "../../shared/deps";
import { FAL_MODELS } from "../../shared/generator";
import { actorOf, projectLoader, startJob } from "../../shared/routes";
import { OverCap, assertUnderCap } from "../usage/spend";
import { startGenerateJob } from "./job";

export function generateRouter(deps: AppDeps) {
  const r = Router();
  const load = projectLoader(deps);

  r.post<{ id: string }>(api.projectGenerate(":id"), async (req, res) => {
    const parsed = GenerateInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    const project = await load(req, res);
    if (!project) return;
    const { source, media, overlayId } = parsed.data;
    if (overlayId && !project.overlays.some((o) => o.id === overlayId)) return res.status(400).json({ error: "unknown_id", id: overlayId });
    if (source === "generate" ? !deps.generator : !deps.stock) return res.status(503).json({ error: source === "generate" ? "generator_unavailable" : "stock_unavailable" });
    if (source === "generate") {
      // Refuse before queueing; the job checks again right before calling fal.
      try {
        await assertUnderCap(deps, FAL_MODELS[media].costCents);
      } catch (err) {
        if (!(err instanceof OverCap)) throw err;
        return res.status(402).json({ error: "over_cap", monthCents: err.monthCents, capCents: err.capCents });
      }
    }
    await startJob(res, () => startGenerateJob(deps, project, parsed.data, actorOf(req)));
  });

  return r;
}
