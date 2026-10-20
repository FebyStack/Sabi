import cors from "cors";
import express from "express";
import { api } from "../../shared/contract";
import { actionsRouter } from "../modules/actions/routes";
import { assetsRouter } from "../modules/assets/routes";
import { brollRouter } from "../modules/broll/routes";
import { editPlanRouter } from "../modules/editplan/routes";
import { eventsRouter } from "../modules/events/routes";
import { framesRouter } from "../modules/frames/routes";
import { pipelineRouter } from "../modules/pipeline/routes";
import { projectsRouter } from "../modules/projects/routes";
import type { AppDeps } from "../shared/deps";

// Pages on this machine (Vite, the Remotion renderer). Browsers send Origin on cross-site writes; Node clients (MCP, curl) send none.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Composition root. Routers carry their full paths; this only wires them.
export function createApp(deps: AppDeps) {
  const app = express();
  app.use(cors({ origin: LOCAL_ORIGIN }));
  // No auth (solo, local): without this any website open in the browser could edit projects or spend fal credits via /broll.
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (req.method !== "GET" && req.method !== "HEAD" && origin !== undefined && !LOCAL_ORIGIN.test(origin)) return res.status(403).json({ error: "cross_origin" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.get(api.health, (_req, res) => res.json({ ok: true, time: deps.now().toISOString() }));
  app.use(projectsRouter(deps));
  app.use(assetsRouter(deps));
  app.use(eventsRouter(deps));
  app.use(pipelineRouter(deps));
  app.use(editPlanRouter(deps));
  app.use(framesRouter(deps));
  app.use(actionsRouter(deps));
  app.use(brollRouter(deps));

  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal" });
  });
  return app;
}
