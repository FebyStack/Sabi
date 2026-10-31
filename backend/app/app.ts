import cors from "cors";
import express from "express";
import { api } from "../../shared/contract";
import { actionsRouter } from "../modules/actions/routes";
import { assetsRouter } from "../modules/assets/routes";
import { brollRouter } from "../modules/broll/routes";
import { editPlanRouter } from "../modules/editplan/routes";
import { eventsRouter } from "../modules/events/routes";
import { framesRouter } from "../modules/frames/routes";
import { generateRouter } from "../modules/generate/routes";
import { pipelineRouter } from "../modules/pipeline/routes";
import { projectsRouter } from "../modules/projects/routes";
import { usageRouter } from "../modules/usage/routes";
import type { AppDeps } from "../shared/deps";
import { servicesProbe } from "./health";
import { registerJobHandlers } from "./jobs";

// Pages on this machine (Vite, the Remotion renderer). Browsers send Origin on cross-site writes; Node clients (MCP, curl) send none.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// ALLOWED_ORIGINS="http://192.168.1.5:5173,…": extra pages allowed to use the API (a phone on the LAN), as bare origins.
export const parseAllowedOrigins = (env: string | undefined) =>
  (env ?? "").split(",").map((o) => o.trim()).filter(Boolean).map((o) => new URL(o).origin);

// Composition root. Routers carry their full paths; this only wires them.
export function createApp(deps: AppDeps) {
  registerJobHandlers(deps);
  const app = express();
  const extra = new Set(deps.allowedOrigins ?? []);
  const allowedOrigin = (o: string) => LOCAL_ORIGIN.test(o) || extra.has(o);
  // A page whose DNS was rebound to 127.0.0.1 still names its own host: only this machine's names, the render host and allowed origins are served.
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", new URL(deps.apiBaseUrl).hostname, ...[...extra].map((o) => new URL(o).hostname)]);
  app.use("/api", (req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!hosts.has(host)) return res.status(403).json({ error: "bad_host" });
    next();
  });
  app.use(cors({ origin: (o, cb) => cb(null, o !== undefined && allowedOrigin(o)) }));
  // No auth (solo, local): without this any website open in the browser could edit projects or spend fal credits via /broll.
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (req.method !== "GET" && req.method !== "HEAD" && origin !== undefined && !allowedOrigin(origin)) return res.status(403).json({ error: "cross_origin" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const services = servicesProbe(deps);
  app.get(api.health, async (_req, res) => res.json({ ok: true, time: deps.now().toISOString(), services: await services() }));
  app.use(projectsRouter(deps));
  app.use(assetsRouter(deps));
  app.use(eventsRouter(deps));
  app.use(pipelineRouter(deps));
  app.use(editPlanRouter(deps));
  app.use(framesRouter(deps));
  app.use(actionsRouter(deps));
  app.use(brollRouter(deps));
  app.use(generateRouter(deps));
  app.use(usageRouter(deps));

  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal" });
  });
  return app;
}
