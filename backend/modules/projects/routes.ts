import { Router } from "express";
import { CreateProjectInput, api } from "../../../shared/contract";
import type { AppDeps } from "../../shared/deps";

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
      sourceAssetId: null, language: null, captionTemplateId: "clean", transcript: null, phrases: [], outputs: {}, warnings: [],
      ...parsed.data,
    });
    res.status(201).json(project);
  });

  r.get<{ id: string }>(api.project(":id"), async (req, res) => {
    const project = await deps.projects.get(req.params.id);
    if (!project) return res.status(404).json({ error: "not_found" });
    res.json(project);
  });

  return r;
}
