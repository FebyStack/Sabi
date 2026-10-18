import type { Request, Response } from "express";
import type { AppDeps } from "./deps";

// Loads `:id`; answers 404 and returns undefined when the project does not exist.
export const projectLoader = (deps: AppDeps) => async (req: Request<{ id: string }>, res: Response) => {
  const project = await deps.projects.get(req.params.id);
  if (!project) res.status(404).json({ error: "not_found" });
  return project;
};
