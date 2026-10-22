import { applyLocalAction, isLocalAction, type LocalError } from "../../../shared/editing/applyLocal";
import type { Action, Asset, MotionGraphic, MotionGraphicProp, Overlay, Project } from "../../../shared/types";
import { compileMotionGraphic } from "../mg/compile";

export type ApplyError = {
  error: LocalError["error"] | "bad_asset" | "bad_code" | "no_source" | "not_in_broll_shot";
  id?: string; detail?: string;
};
export type ApplyContext = { assets: ReadonlyMap<string, Asset> };

type ServerAction = Extract<Action, { type: "replaceOverlay" | "addOverlay" | "setBrand" | "addMotionGraphic" | "updateMotionGraphic" }>;
type MgAction = Extract<Action, { type: "addMotionGraphic" | "updateMotionGraphic" }>;
const imageIds = (props: MotionGraphicProp[] | undefined) => (props ?? []).flatMap((p) => (p.type === "image" ? [p.value] : []));

// Asset ids the route must load before applyActions (which stays pure).
export function referencedAssetIds(actions: Action[]): string[] {
  return actions.flatMap((a) => {
    if (a.type === "replaceOverlay" || a.type === "addOverlay") return [a.assetId];
    if (a.type === "setBrand") return a.brand?.logoAssetId ? [a.brand.logoAssetId] : [];
    if (a.type === "addMotionGraphic" || a.type === "updateMotionGraphic") return imageIds(a.props);
    return [];
  });
}

// `mg-<n>`/`ov-<n>`: one past the highest existing suffix.
export const nextId = (prefix: string, ids: string[]) =>
  `${prefix}-${Math.max(-1, ...ids.map((id) => Number(id.slice(prefix.length + 1))).filter(Number.isInteger)) + 1}`;

// The overlay fields a placed asset decides, provenance included (absent meta = uploaded). Text is cut to OverlaySchema's limits.
const fromAsset = (asset: Asset & { kind: "image" | "video" }) => ({
  assetId: asset.id, media: asset.kind, source: asset.meta?.source ?? ("uploaded" as const),
  ...(asset.kind === "video" && asset.durationMs ? { durationMs: asset.durationMs } : {}),
  ...(asset.meta?.attribution ? { attribution: asset.meta.attribution } : {}),
  ...(asset.meta?.generationInfo ? { generationInfo: asset.meta.generationInfo } : {}),
  ...(asset.meta?.prompt !== undefined ? { prompt: asset.meta.prompt.slice(0, 600) } : {}),
  ...(asset.meta?.query !== undefined ? { query: asset.meta.query.slice(0, 200) } : {}),
});
const isMedia = (a: Asset | undefined): a is Asset & { kind: "image" | "video" } => a?.kind === "image" || a?.kind === "video";

// The actions that need assets or the MG compiler; every other action is the shared local fold.
function applyServerAction(p: Project, a: ServerAction, ctx: ApplyContext): Project | ApplyError {
  const isKind = (id: string, kind: Asset["kind"][]) => kind.includes(ctx.assets.get(id)?.kind as Asset["kind"]);
  const mgRange = (m: { startMs: number; endMs: number }): ApplyError | null => {
    if (p.sourceDurationMs === null) return { error: "no_source" };
    return m.endMs > m.startMs && m.endMs <= p.sourceDurationMs ? null : { error: "out_of_range" };
  };
  const mgCode = (m: MgAction): ApplyError | { compiled?: string } => {
    const badImage = imageIds(m.props).find((id) => !isKind(id, ["image"]));
    if (badImage) return { error: "bad_asset", id: badImage };
    if (m.code === undefined) return {};
    const out = compileMotionGraphic(m.code);
    return "error" in out ? out : { compiled: out.compiled };
  };

  if (a.type === "setBrand") {
    if (a.brand?.logoAssetId && !isKind(a.brand.logoAssetId, ["image"])) return { error: "bad_asset", id: a.brand.logoAssetId };
    return { ...p, brand: a.brand };
  }
  if (a.type === "replaceOverlay") {
    const o = p.overlays.find((x) => x.id === a.overlayId);
    if (!o) return { error: "unknown_id", id: a.overlayId };
    const asset = ctx.assets.get(a.assetId);
    if (!isMedia(asset)) return { error: "bad_asset", id: a.assetId };
    const { attribution: _a, generationInfo: _g, durationMs: _d, ...rest } = o;
    const next = { ...rest, ...fromAsset(asset) };
    return { ...p, overlays: p.overlays.map((x) => (x.id === o.id ? next : x)) };
  }
  if (a.type === "addOverlay") {
    const asset = ctx.assets.get(a.assetId);
    if (!isMedia(asset)) return { error: "bad_asset", id: a.assetId };
    if (p.sourceDurationMs === null) return { error: "no_source" };
    if (a.endMs <= a.startMs || a.endMs > p.sourceDurationMs) return { error: "out_of_range" };
    // Overlays are drawn only over B-roll shots, so the range must sit inside one.
    const shot = p.editPlan?.shots.find((s) => (s.kind === "B-Roll" || s.kind === "Talking Head & B-Roll") && s.startMs <= a.startMs && a.endMs <= s.endMs);
    if (!shot) return { error: "not_in_broll_shot" };
    if (p.overlays.some((o) => o.enabled && o.startMs < a.endMs && a.startMs < o.endMs)) return { error: "overlap" };
    const overlay: Overlay = {
      id: nextId("ov", p.overlays.map((o) => o.id)), shotId: shot.id, startMs: a.startMs, endMs: a.endMs,
      placement: a.placement ?? (shot.kind === "B-Roll" ? "full" : "top"), transition: a.transition ?? "fade", enabled: true,
      query: "", prompt: "", intent: "", ...fromAsset(asset),
    };
    return { ...p, overlays: [...p.overlays, overlay] };
  }
  const code = mgCode(a);
  if ("error" in code) return code;
  if (a.type === "addMotionGraphic") {
    const { type: _t, ...input } = a;
    const mg: MotionGraphic = { ...input, id: nextId("mg", p.motionGraphics.map((m) => m.id)), compiled: code.compiled!, enabled: true };
    return mgRange(mg) ?? { ...p, motionGraphics: [...p.motionGraphics, mg] };
  }
  const old = p.motionGraphics.find((m) => m.id === a.mgId);
  if (!old) return { error: "unknown_id", id: a.mgId };
  const { type: _t, mgId: _id, ...changes } = a;
  const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  const mg: MotionGraphic = { ...old, ...defined, ...(code.compiled ? { compiled: code.compiled } : {}) };
  return mgRange(mg) ?? { ...p, motionGraphics: p.motionGraphics.map((m) => (m.id === mg.id ? mg : m)) };
}

// Pure: fold the actions in order (all or nothing) into one patch of the fields that changed.
// `rerender` is true when the MP4 would change; titles and the media source don't touch it.
export function applyActions(project: Project, actions: Action[], ctx: ApplyContext = { assets: new Map() }):
  { patch: Partial<Project>; rerender: boolean } | ApplyError {
  let cur = project;
  let rerender = false;
  for (const a of actions) {
    if (isLocalAction(a)) {
      const out = applyLocalAction(cur, a);
      if ("error" in out) return out;
      cur = out.project;
      rerender ||= out.rerender;
    } else {
      const out = applyServerAction(cur, a as ServerAction, ctx);
      if ("error" in out) return out;
      cur = out;
      rerender = true;
    }
  }
  const patch = Object.fromEntries(Object.entries(cur).filter(([k, v]) => project[k as keyof Project] !== v)) as Partial<Project>;
  return { patch, rerender };
}
