import { Router } from "express";
import { readFile, rm } from "node:fs/promises";
import { MG_PROBLEMS_HEADER, api } from "../../../shared/contract";
import { captionVideoProps } from "../../../shared/editing/renderProps";
import { mgProblemsHeader } from "../../../shared/remotion/mgProtocol";
import type { MgProblem } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";
import { projectLoader } from "../../shared/routes";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// A still of the *output* timeline (cuts applied), drawn by the same props as the MP4, so what the agent sees is what exports.
export function framesRouter(deps: AppDeps) {
  const r = Router();
  const load = projectLoader(deps);

  r.get<{ id: string }>(api.projectFrame(":id"), async (req, res) => {
    const project = await load(req, res);
    if (!project) return;
    if (!project.phrases.length) return res.status(400).json({ error: "no_captions" });
    const job = await deps.jobs.active(project.id);
    if (job) return res.status(409).json({ error: "busy", job });
    const source = project.sourceAssetId ? await deps.assets.get(project.sourceAssetId) : null;
    if (!source) return res.status(400).json({ error: "no_source" });

    const props = captionVideoProps(project, { videoSrc: `${deps.apiBaseUrl}${api.assetFile(source.id)}`, sourceDurationMs: source.durationMs ?? 0, assetUrl: (id) => `${deps.apiBaseUrl}${api.assetFile(id)}` });
    const t = Math.round(clamp(Number(req.query.t) || 0, 0, props.durationMs));
    const w = Math.round(clamp(Number(req.query.w) || 540, 160, 1080));
    // One scratch file per request, deleted once read: on the ExFAT DATA_DIR every file or folder costs 1 MiB, so stills must never
    // accumulate, nor a folder per project (removing one could race a concurrent request's still).
    const outPath = deps.storage.workPath(`frames/${project.id}-${deps.id()}.png`);
    let png: Buffer, mgProblems: MgProblem[];
    try {
      ({ mgProblems } = await deps.renderer.renderStill({ compositionId: "CaptionVideo", inputProps: props, timestampMs: t, width: w, outPath }));
      png = await readFile(outPath);
    } finally {
      await rm(outPath, { force: true });
    }
    res.set({ "content-type": "image/png", "cache-control": "no-store", "x-sabi-frame-ms": String(t) });
    if (mgProblems.length) res.set(MG_PROBLEMS_HEADER, mgProblemsHeader(mgProblems)); // why an MG shows ⚠, for the agent
    res.send(png);
  });

  return r;
}
