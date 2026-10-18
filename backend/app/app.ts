import cors from "cors";
import express from "express";
import { api } from "../../shared/contract";
import { projectsRouter } from "../modules/projects/routes";
import type { AppDeps } from "../shared/deps";

// Composition root. Routers carry their full paths; this only wires them.
export function createApp(deps: AppDeps) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get(api.health, (_req, res) => res.json({ ok: true, time: deps.now().toISOString() }));
  app.use(projectsRouter(deps));

  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal" });
  });
  return app;
}
