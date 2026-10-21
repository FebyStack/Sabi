import { retimePhrase } from "../../../shared/captions/retime";
import { carryEmoji, segmentCaptions } from "../../../shared/captions/segment";
import { getCaptionTemplate } from "../../../shared/captions/templates";
import type { Action, Asset, MotionGraphic, MotionGraphicProp, Overlay, Project } from "../../../shared/types";
import { validatePlanEdit, type PlanEdit, type PlanEditError } from "../editplan/validate";
import { compileMotionGraphic } from "../mg/compile";

export type ApplyError = {
  error: PlanEditError["error"] | "no_captions" | "bad_asset" | "out_of_shot" | "out_of_range" | "bad_code" | "no_source";
  id?: string; detail?: string;
};
export type ApplyContext = { assets: ReadonlyMap<string, Asset> };

type MgAction = Extract<Action, { type: "addMotionGraphic" | "updateMotionGraphic" }>;
const imageIds = (props: MotionGraphicProp[] | undefined) => (props ?? []).flatMap((p) => (p.type === "image" ? [p.value] : []));

// Asset ids the route must load before applyActions (which stays pure).
export function referencedAssetIds(actions: Action[]): string[] {
  return actions.flatMap((a) => {
    if (a.type === "replaceOverlay") return [a.assetId];
    if (a.type === "setBrand") return a.brand?.logoAssetId ? [a.brand.logoAssetId] : [];
    if (a.type === "addMotionGraphic" || a.type === "updateMotionGraphic") return imageIds(a.props);
    return [];
  });
}

// `mg-<n>`/`ov-<n>`: one past the highest existing suffix.
export const nextId = (prefix: string, ids: string[]) =>
  `${prefix}-${Math.max(-1, ...ids.map((id) => Number(id.slice(prefix.length + 1))).filter(Number.isInteger)) + 1}`;

// Pure: validate every action against the project, then fold them into one patch (all or nothing).
// `rerender` is true when the MP4 would change; titles and the media source don't touch it.
export function applyActions(project: Project, actions: Action[], ctx: ApplyContext = { assets: new Map() }):
  { patch: Partial<Project>; rerender: boolean } | ApplyError {
  const patch: Partial<Project> = {};
  const plan: PlanEdit = { cuts: [], shots: [] };
  const edits = new Map<string, string>();
  let overlays: Overlay[] | undefined;
  let mgs: MotionGraphic[] | undefined;
  let layersChanged = false;
  const shots = project.editPlan?.shots ?? [];
  const isKind = (id: string, kind: Asset["kind"][]) => kind.includes(ctx.assets.get(id)?.kind as Asset["kind"]);

  const mgRange = (m: { startMs: number; endMs: number }): ApplyError | null => {
    if (project.sourceDurationMs === null) return { error: "no_source" };
    return m.endMs > m.startMs && m.endMs <= project.sourceDurationMs ? null : { error: "out_of_range" };
  };
  const mgCode = (a: MgAction): ApplyError | { compiled?: string } => {
    const badImage = imageIds(a.props).find((id) => !isKind(id, ["image"]));
    if (badImage) return { error: "bad_asset", id: badImage };
    if (a.code === undefined) return {};
    const out = compileMotionGraphic(a.code);
    return "error" in out ? out : { compiled: out.compiled };
  };

  for (const a of actions) {
    if (a.type === "setTitle") patch.title = a.title;
    else if (a.type === "editPhrase") edits.set(a.phraseId, a.text);
    else if (a.type === "setCut") plan.cuts.push({ id: a.cutId, shouldTrim: a.shouldTrim });
    else if (a.type === "setShotKind") plan.shots.push({ id: a.shotId, kind: a.kind });
    else if (a.type === "setTemplate") patch.captionTemplateId = a.captionTemplateId;
    else if (a.type === "setBurnIn") plan.burnInLanguage = a.language;
    else if (a.type === "setMediaSource") patch.mediaSource = a.mediaSource;
    else if (a.type === "setBrand") {
      if (a.brand?.logoAssetId && !isKind(a.brand.logoAssetId, ["image"])) return { error: "bad_asset", id: a.brand.logoAssetId };
      patch.brand = a.brand;
      layersChanged = true;
    } else if (a.type === "setOverlay" || a.type === "removeOverlay" || a.type === "replaceOverlay") {
      overlays ??= [...project.overlays];
      const i = overlays.findIndex((o) => o.id === a.overlayId);
      if (i < 0) return { error: "unknown_id", id: a.overlayId };
      const o = overlays[i];
      layersChanged = true;
      if (a.type === "removeOverlay") overlays.splice(i, 1);
      else if (a.type === "replaceOverlay") {
        const asset = ctx.assets.get(a.assetId);
        if (asset?.kind !== "image" && asset?.kind !== "video") return { error: "bad_asset", id: a.assetId };
        const { attribution: _a, generationInfo: _g, durationMs: _d, ...rest } = o;
        overlays[i] = { ...rest, assetId: asset.id, media: asset.kind, source: "uploaded", ...(asset.kind === "video" && asset.durationMs ? { durationMs: asset.durationMs } : {}) };
      } else {
        const startMs = a.startMs ?? o.startMs, endMs = a.endMs ?? o.endMs;
        if (a.startMs !== undefined || a.endMs !== undefined) {
          const shot = shots.find((s) => s.id === o.shotId);
          if (!shot || startMs < shot.startMs || endMs > shot.endMs || endMs <= startMs) return { error: "out_of_shot", id: o.id };
        }
        overlays[i] = { ...o, startMs, endMs, enabled: a.enabled ?? o.enabled, placement: a.placement ?? o.placement, transition: a.transition ?? o.transition };
      }
    } else {
      mgs ??= [...project.motionGraphics];
      layersChanged = true;
      if (a.type === "removeMotionGraphic") {
        const i = mgs.findIndex((m) => m.id === a.mgId);
        if (i < 0) return { error: "unknown_id", id: a.mgId };
        mgs.splice(i, 1);
        continue;
      }
      const code = mgCode(a);
      if ("error" in code) return code;
      if (a.type === "addMotionGraphic") {
        const { type: _t, ...input } = a;
        const mg: MotionGraphic = { ...input, id: nextId("mg", mgs.map((m) => m.id)), compiled: code.compiled!, enabled: true };
        const bad = mgRange(mg);
        if (bad) return bad;
        mgs.push(mg);
      } else {
        const i = mgs.findIndex((m) => m.id === a.mgId);
        if (i < 0) return { error: "unknown_id", id: a.mgId };
        const { type: _t, mgId: _id, ...changes } = a;
        const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
        const mg: MotionGraphic = { ...mgs[i], ...defined, ...(code.compiled ? { compiled: code.compiled } : {}) };
        const bad = mgRange(mg);
        if (bad) return bad;
        mgs[i] = mg;
      }
    }
  }

  if (edits.size && !project.phrases.length) return { error: "no_captions" };
  const missing = [...edits.keys()].find((id) => !project.phrases.some((p) => p.id === id));
  if (missing) return { error: "unknown_id", id: missing };
  const v = validatePlanEdit(project, plan);
  if ("error" in v) return v;

  if (overlays) patch.overlays = overlays;
  if (mgs) patch.motionGraphics = mgs;
  if (plan.cuts.length || plan.shots.length) patch.editPlan = v.editPlan;
  if (v.burnInChanged) patch.burnInLanguage = plan.burnInLanguage;
  if (edits.size) patch.phrases = project.phrases.map((p) => (edits.has(p.id) ? retimePhrase(p, edits.get(p.id)!) : p));
  const templateChanged = patch.captionTemplateId !== undefined && patch.captionTemplateId !== project.captionTemplateId;
  if (templateChanged && project.phrases.length) {
    // The new layout re-flows the (edited) words now, so a still frame shows it before any render.
    const phrases = patch.phrases ?? project.phrases;
    patch.phrases = carryEmoji(phrases, segmentCaptions(phrases.flatMap((p) => p.words), getCaptionTemplate(patch.captionTemplateId!).layout));
  }
  // Overlays are drawn only over B-roll shots, so a shot-kind change matters once there are overlays.
  const overlaysFollowShots = v.shotsChanged && (overlays ?? project.overlays).length > 0;
  return { patch, rerender: edits.size > 0 || templateChanged || v.cutsChanged || v.burnInChanged || layersChanged || overlaysFollowShots };
}
