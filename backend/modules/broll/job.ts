import type { z } from "zod";
import type { BrollInput } from "../../../shared/contract";
import { deriveBeats } from "../../../shared/editing/beats";
import { DIMS } from "../../../shared/editing/renderProps";
import type { Actor, Asset, AssetMeta, JobState, Overlay, OverlayMedia, Project, ProjectStatus } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";
import type { JobHandler } from "../../shared/jobs";
import { importAsAsset } from "../../shared/importRemote";
import { nextId } from "../actions/apply";
import { renderOutputs } from "../pipeline/pipeline";
import { OverCap, chargeGeneration } from "../usage/spend";
import { labelBeats } from "./labeler";

type Spec = { media: OverlayMedia; query: string; prompt: string; intent: string };
type Resolved = Pick<Overlay, "assetId" | "media" | "source" | "attribution" | "generationInfo" | "durationMs">;
const MAX_TRIES = 3;
const isBrollWarning = (w: string) => w === "no_broll_shots" || w === "over_cap" || w.startsWith("broll_not_found:");

// Job "broll": beats → labels → media per beat (fal or Pexels, copied into storage) → save → render.
// A missing provider fails before anything is written; a beat with no media is skipped with a warning.
export function startBrollJob(deps: AppDeps, project: Project, input: z.infer<typeof BrollInput>, actor: Actor): Promise<JobState> {
  return deps.jobs.enqueue(project.id, "broll", { input, actor, prevStatus: project.status });
}

export const brollJob = (deps: AppDeps): JobHandler => async ({ projectId, data, report }) => {
  const input = data.input as z.infer<typeof BrollInput>;
  const project = await deps.projects.get(projectId);
  if (!project) throw new Error("not_found");
  const setStatus = async (status: ProjectStatus, patch: Partial<Project> = {}) => {
    const updated = await deps.projects.update(project.id, { status, ...patch });
    deps.bus.publish(project.id, { type: "project", status });
    return updated;
  };
  const generate = project.mediaSource === "generate";
  let saved = false;
  try {
    if (generate ? !deps.generator : !deps.stock) throw new Error(generate ? "generator_unavailable" : "stock_unavailable");
    const source = await deps.assets.get(project.sourceAssetId!);
    if (!source) throw new Error("no_source");
    await setStatus("generating");
    report(10, "beats");

    let credits = 0;
    const warnings: string[] = [];
    const orientation = project.aspectRatio === "9:16" ? "portrait" : "landscape";

    const importAsset = (url: string, media: OverlayMedia, meta: AssetMeta) => importAsAsset(deps, { projectId: project.id, url, media, meta });
    const fromAsset = (a: Asset): Pick<Resolved, "assetId" | "media" | "durationMs"> =>
      ({ assetId: a.id, media: a.kind as OverlayMedia, ...(a.kind === "video" && a.durationMs ? { durationMs: a.durationMs } : {}) });

    const fromStock = async (spec: Spec, opts: { page?: number; skipUrl?: string }): Promise<Resolved | null> => {
      if (!deps.stock) return null;
      const search = (q: string) => deps.stock!.search(q, { media: spec.media, orientation, ...(opts.page ? { page: opts.page } : {}) })
        .then((rs) => rs.filter((r) => r.attribution.url !== opts.skipUrl))
        .catch(() => []); // rate-limited or down mid-job: this beat is skipped, the job goes on
      let results = await search(spec.query);
      if (!results.length && spec.intent && spec.intent !== spec.query) results = await search(spec.intent);
      for (const r of results.slice(0, MAX_TRIES)) {
        const asset = await importAsset(r.url, r.media, { source: "stock", attribution: r.attribution, query: spec.query }).catch(() => null);
        if (asset) return { ...fromAsset(asset), source: "stock", attribution: r.attribution };
      }
      return null;
    };
    const resolve = async (spec: Spec, opts: { page?: number; skipUrl?: string } = {}): Promise<Resolved | null> => {
      if (generate) {
        try {
          const g = await chargeGeneration(deps, { projectId: project.id, prompt: spec.prompt, media: spec.media, ...DIMS[project.aspectRatio], jobKind: "broll", actor: data.actor });
          credits += g.costCents; // spent at fal even if the file turns out unusable
          const generationInfo = { provider: "fal" as const, model: g.model, prompt: spec.prompt, costCents: g.costCents };
          const asset = await importAsset(g.url, g.media, { source: "generated", generationInfo, prompt: spec.prompt });
          return { ...fromAsset(asset), source: "generated", generationInfo };
        } catch (err) {
          // fal failed, or the month's cap is reached, for this beat: Pexels, never the reverse.
          if (err instanceof OverCap && !warnings.includes("over_cap")) warnings.push("over_cap");
        }
      }
      return fromStock(spec, opts);
    };

    let overlays: Overlay[];
    const shots = project.editPlan!.shots;
    if (input.overlayId) {
      // One overlay: another stock pick (page 2, not the current photo) or a new generation, same range and id.
      overlays = [...project.overlays];
      const i = overlays.findIndex((o) => o.id === input.overlayId);
      const o = overlays[i];
      const spec = { media: o.media, query: input.query ?? o.query, prompt: input.prompt ?? o.prompt, intent: o.intent };
      report(20, "fetch");
      const got = await resolve(spec, { page: 2, skipUrl: o.attribution?.url });
      if (got) {
        const { attribution: _a, generationInfo: _g, durationMs: _d, ...rest } = o;
        overlays[i] = { ...rest, ...got, query: spec.query, prompt: spec.prompt };
      } else warnings.push(`broll_not_found:${o.id}`);
    } else {
      const beats = deriveBeats(shots, { allowVideo: generate });
      overlays = [];
      if (!beats.length) warnings.push("no_broll_shots");
      else {
        report(20, "label");
        const labeled = await labelBeats(deps.llm, beats, project.phrases, { allowVideo: generate });
        for (const [n, b] of labeled.entries()) {
          report(20 + (60 * n) / labeled.length, "fetch");
          const shot = shots.find((s) => s.id === b.shotId)!;
          const keep = !input.regenerate && project.overlays.find((o) =>
            o.shotId === b.shotId && o.media === b.media && o.startMs >= shot.startMs && o.endMs <= shot.endMs);
          if (keep) { overlays.push(keep); continue; }
          const got = await resolve(b);
          if (!got) { warnings.push(`broll_not_found:${b.id}`); continue; }
          overlays.push({
            id: nextId("ov", [...project.overlays, ...overlays].map((o) => o.id)), shotId: b.shotId, ...got,
            startMs: b.startMs, endMs: b.endMs, placement: b.placement, transition: "fade", enabled: true, query: b.query, prompt: b.prompt, intent: b.intent,
          });
        }
      }
    }
    report(80, "fetch");

    const current = await setStatus("rendering", {
      overlays, creditsUsedCents: project.creditsUsedCents + credits, warnings: [...project.warnings.filter((w) => !isBrollWarning(w)), ...warnings],
    });
    saved = true;
    const outputs = await renderOutputs(deps, current, source, (p, stage) => report(stage === "render" ? 85 : p, stage));
    await setStatus("ready", { outputs });
    report(100);
  } catch (err) {
    await setStatus(saved ? "failed" : data.prevStatus);
    throw err;
  }
};
