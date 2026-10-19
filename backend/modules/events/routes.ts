import { Router } from "express";
import { api } from "../../../shared/contract";
import type { ProjectEvent } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";

export function eventsRouter(deps: AppDeps) {
  const r = Router();

  r.get<{ id: string }>(api.projectEvents(":id"), (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: ProjectEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const active = deps.jobs.active(req.params.id);
    if (active) send({ type: "job", job: active });
    const unsubscribe = deps.bus.subscribe(req.params.id, send);
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    req.on("close", () => { clearInterval(keepalive); unsubscribe(); });
  });

  // Polling twin of the SSE stream for clients that can't hold one open (the MCP server).
  r.get<{ id: string }>(api.projectJob(":id"), (req, res) => { res.json(deps.jobs.active(req.params.id)); });

  return r;
}
