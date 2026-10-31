import { Router } from "express";
import { api } from "../../../shared/contract";
import type { ProjectEvent } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";

export function eventsRouter(deps: AppDeps) {
  const r = Router();

  r.get<{ id: string }>(api.projectEvents(":id"), async (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: ProjectEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    let live = false;
    const unsubscribe = deps.bus.subscribe(req.params.id, (e) => { live = true; send(e); }); // before the awaits, so no event falls between
    const active = await deps.jobs.active(req.params.id);
    if (active) send({ type: "job", job: active });
    else if ((await deps.projects.get(req.params.id))?.status === "failed") {
      // A reload of a failed project still says why (its error copy), as the live stream did — only while the project is failed
      // (a failed plan restores the old status) and nothing newer has streamed meanwhile.
      const last = await deps.jobs.last(req.params.id);
      if (!live && last?.state === "FAILED") send({ type: "job", job: last });
    }
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    req.on("close", () => { clearInterval(keepalive); unsubscribe(); });
  });

  // Polling twin of the SSE stream for clients that can't hold one open (the MCP server): the running job, else the last finished one;
  // ?id= asks for one job (generate_assets waits on its own job even after another started).
  r.get<{ id: string }>(api.projectJob(":id"), async (req, res) => {
    const id = req.params.id;
    if (typeof req.query.id === "string") {
      const job = await deps.jobs.get(id, req.query.id);
      return job ? res.json(job) : res.status(404).json({ error: "not_found" });
    }
    res.json((await deps.jobs.active(id)) ?? (await deps.jobs.last(id)));
  });

  return r;
}
