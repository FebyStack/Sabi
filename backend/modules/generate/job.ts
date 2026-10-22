import type { z } from "zod";
import type { GenerateInput } from "../../../shared/contract";
import { DIMS } from "../../../shared/editing/renderProps";
import type { Actor, Asset, JobState, Project } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";
import { importAsAsset } from "../../shared/importRemote";
import type { JobHandler } from "../../shared/jobs";
import { applyActions } from "../actions/apply";
import { chargeGeneration } from "../usage/spend";

type Input = z.infer<typeof GenerateInput>;
const CANDIDATES = 3; // stock picks the agent can look at; an overlay swap takes one

export function startGenerateJob(deps: AppDeps, project: Project, input: Input, actor: Actor): Promise<JobState> {
  return deps.jobs.enqueue(project.id, "generate", { input, actor, prevStatus: project.status });
}

// Job "generate": one fal asset (prompt) or up to 3 Pexels candidates (query), stored with provenance. It never renders; the project
// shows "generating" while it runs (so the editor knows its own job made the change) and then gets its previous status back.
// With overlayId the first asset replaces that overlay's media and the MP4 goes stale.
export const generateJob = (deps: AppDeps): JobHandler => async ({ projectId, data, report }) => {
  const input = data.input as Input;
  const project = await deps.projects.get(projectId);
  if (!project) throw new Error("not_found");
  const assets: Asset[] = [];
  let costCents = 0;
  await deps.projects.update(projectId, { status: "generating" });
  deps.bus.publish(projectId, { type: "project", status: "generating" });
  try {
    report(10, "generate");
    if (input.source === "generate") {
      const prompt = input.prompt!;
      const g = await chargeGeneration(deps, { projectId, prompt, media: input.media, ...DIMS[project.aspectRatio], jobKind: "generate", actor: data.actor,
        onCharged: (c) => { costCents += c; } });
      report(60, "import");
      const generationInfo = { provider: "fal" as const, model: g.model, prompt, costCents: g.costCents };
      assets.push(await importAsAsset(deps, { projectId, url: g.url, media: g.media, meta: { source: "generated", generationInfo, prompt } }));
    } else {
      if (!deps.stock) throw new Error("stock_unavailable");
      const query = input.query!;
      const results = await deps.stock.search(query, { media: input.media, orientation: project.aspectRatio === "9:16" ? "portrait" : "landscape" });
      report(40, "import");
      for (const r of results) {
        if (assets.length === (input.overlayId ? 1 : CANDIDATES)) break;
        const asset = await importAsAsset(deps, { projectId, url: r.url, media: r.media, meta: { source: "stock", attribution: r.attribution, query } }).catch(() => null);
        if (asset) assets.push(asset);
      }
      if (!assets.length) throw new Error("not_found");
    }
  } finally {
    // The job holds the project (actions answer 409 busy), so this patch cannot race an edit. fal's charge counts even if the import failed.
    const latest = await deps.projects.get(projectId);
    const swap = latest && input.overlayId && assets[0]
      ? applyActions(latest, [{ type: "replaceOverlay", overlayId: input.overlayId, assetId: assets[0].id }], { assets: new Map([[assets[0].id, assets[0]]]) })
      : null;
    const patch: Partial<Project> = {
      status: data.prevStatus,
      ...(costCents ? { creditsUsedCents: (latest?.creditsUsedCents ?? 0) + costCents } : {}),
      ...(swap && !("error" in swap) ? { ...swap.patch, ...(latest!.outputs.mp4AssetId ? { outputs: { ...latest!.outputs, stale: true } } : {}) } : {}),
    };
    if (latest) {
      const updated = await deps.projects.update(projectId, patch);
      deps.bus.publish(projectId, { type: "project", status: updated.status }); // open tabs refetch
    }
  }
  report(100);
  return { assetIds: assets.map((a) => a.id) };
};
