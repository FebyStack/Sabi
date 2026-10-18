import { Router, type Request, type Response } from "express";
import { RunInput, SetSourceInput, UpdatePhrasesInput, UpdateTemplateInput, api } from "../../../shared/contract";
import type { AppDeps } from "../../shared/deps";
import { startCaptionJob, type RunOptions } from "./pipeline";

export function pipelineRouter(deps: AppDeps) {
  const r = Router();

  const load = async (req: Request<{ id: string }>, res: Response) => {
    const project = await deps.projects.get(req.params.id);
    if (!project) res.status(404).json({ error: "not_found" });
    return project;
  };

  const run = async (req: Request<{ id: string }>, res: Response, opts: RunOptions) => {
    const project = await load(req, res);
    if (!project) return;
    if (!project.sourceAssetId) return res.status(400).json({ error: "no_source" });
    if (deps.jobs.active(project.id)) return res.status(409).json({ error: "busy" });
    const job = startCaptionJob(deps, project, opts);
    res.status(202).json({ jobId: job.id });
  };

  r.post<{ id: string }>(api.projectSource(":id"), async (req, res) => {
    const parsed = SetSourceInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const project = await load(req, res);
    if (!project) return;
    const asset = await deps.assets.get(parsed.data.assetId);
    if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) return res.status(400).json({ error: "bad_asset" });
    const aspectRatio = asset.width && asset.height && asset.width > asset.height ? "16:9" : "9:16";
    res.json(await deps.projects.update(project.id, { sourceAssetId: asset.id, sourceKind: asset.kind, aspectRatio, status: "draft" }));
  });

  r.post<{ id: string }>(api.projectRun(":id"), async (req, res) => {
    const parsed = RunInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    await run(req, res, { language: parsed.data.language, transcribe: true, resegment: true });
  });

  r.put<{ id: string }>(api.projectPhrases(":id"), async (req, res) => {
    const parsed = UpdatePhrasesInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const project = await load(req, res);
    if (!project) return;
    if (deps.jobs.active(project.id)) return res.status(409).json({ error: "busy" });
    const updated = await deps.projects.update(project.id, { phrases: parsed.data.phrases });
    const job = startCaptionJob(deps, updated, { transcribe: false, resegment: false });
    res.status(202).json({ jobId: job.id });
  });

  r.put<{ id: string }>(api.projectTemplate(":id"), async (req, res) => {
    const parsed = UpdateTemplateInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const project = await load(req, res);
    if (!project) return;
    if (deps.jobs.active(project.id)) return res.status(409).json({ error: "busy" });
    const updated = await deps.projects.update(project.id, { captionTemplateId: parsed.data.captionTemplateId });
    if (!updated.sourceAssetId || !updated.transcript) return res.json(updated); // nothing to re-render yet
    const job = startCaptionJob(deps, updated, { transcribe: false, resegment: true });
    res.status(202).json({ jobId: job.id });
  });

  return r;
}
