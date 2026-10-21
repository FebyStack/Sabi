import { Router } from "express";
import { CreateProjectInput, UpdateProjectInput, api } from "../../../shared/contract";
import type { AppDeps } from "../../shared/deps";
import { projectLoader } from "../../shared/routes";

export function projectsRouter(deps: AppDeps) {
  const r = Router();

  r.get(api.projects, async (_req, res) => {
    res.json(await deps.projects.list());
  });

  r.post(api.projects, async (req, res) => {
    const parsed = CreateProjectInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    const now = deps.now().toISOString();
    const project = await deps.projects.create({
      id: deps.id(), status: "draft", createdAt: now, updatedAt: now,
      sourceAssetId: null, sourceKind: null, language: null, captionTemplateId: "clean", transcript: null, phrases: [], outputs: {}, warnings: [],
      sourceDurationMs: null, editPlan: null, translations: [], burnInLanguage: null, overlays: [], creditsUsedCents: 0, brand: null, motionGraphics: [],
      captionStyle: null, demo: false, ...parsed.data,
    });
    res.status(201).json(project);
  });

  r.get<{ id: string }>(api.project(":id"), async (req, res) => {
    const project = await deps.projects.get(req.params.id);
    if (!project) return res.status(404).json({ error: "not_found" });
    res.json(project);
  });

  r.patch<{ id: string }>(api.projectUpdate(":id"), async (req, res) => {
    const parsed = UpdateProjectInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const project = await projectLoader(deps)(req, res);
    if (!project) return;
    if (deps.jobs.active(project.id)) return res.status(409).json({ error: "busy" });
    res.json(await deps.projects.update(project.id, parsed.data));
  });

  return r;
}
