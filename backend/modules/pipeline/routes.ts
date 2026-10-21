import { Router, type Request, type Response } from "express";
import { RenderInput, RunInput, SetSourceInput, api } from "../../../shared/contract";
import type { AppDeps } from "../../shared/deps";
import { projectLoader } from "../../shared/routes";
import { startCaptionJob, type RunOptions } from "./pipeline";

export function pipelineRouter(deps: AppDeps) {
  const r = Router();

  const load = projectLoader(deps);

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
    // A plan belongs to one source.
    res.json(await deps.projects.update(project.id, {
      sourceAssetId: asset.id, sourceKind: asset.kind, aspectRatio, status: "draft", sourceDurationMs: asset.durationMs ?? null,
      editPlan: null, translations: [], burnInLanguage: null,
    }));
  });

  r.post<{ id: string }>(api.projectRun(":id"), async (req, res) => {
    const parsed = RunInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    await run(req, res, { language: parsed.data.language, transcribe: true, resegment: true });
  });

  // The explicit export: re-render the current edits (no transcription, no re-flow) at 1080p or 4K.
  r.post<{ id: string }>(api.projectRender(":id"), async (req, res) => {
    const parsed = RenderInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const project = await load(req, res);
    if (!project) return;
    if (!project.phrases.length) return res.status(400).json({ error: "no_captions" });
    const job = deps.jobs.active(project.id);
    if (job) return res.status(409).json({ error: "busy", job });
    res.status(202).json({ jobId: startCaptionJob(deps, project, { transcribe: false, resegment: false, scale: parsed.data.scale }).id });
  });

  return r;
}
