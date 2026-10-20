import type { Box, Cut, MotionGraphic, Overlay, OverlayMedia, OverlayPlacement, Project, Shot } from "../types";
import { mapTime } from "./cuts";

export const MIN_LAYER_MS = 500;

// Output time (after cuts); src already resolved to a URL.
export type OverlayProps = {
  id: string; src: string; media: OverlayMedia; startMs: number; endMs: number; placement: OverlayPlacement; transition: "fade" | "none"; durationMs?: number;
};
export type MotionGraphicProps = { id: string; compiled: string; startMs: number; endMs: number; box: Box; props: Record<string, string | number | boolean> };

const isBroll = (s: Shot | undefined) => s?.kind === "B-Roll" || s?.kind === "Talking Head & B-Roll";

// A range through the enabled cuts; null when what is left is too short to show.
function toOutput(startMs: number, endMs: number, cuts: Cut[]) {
  const s = mapTime(startMs, cuts), e = mapTime(endMs, cuts);
  return e - s < MIN_LAYER_MS ? null : { startMs: s, endMs: e };
}

// Overlays whose shot was re-planned away or is no longer a B-roll kind: kept, not drawn, replaced by the next B-roll run.
export function staleOverlays(project: Project): string[] {
  const shots = project.editPlan?.shots ?? [];
  return project.overlays.filter((o) => !isBroll(shots.find((s) => s.id === o.shotId))).map((o) => o.id);
}

export function overlayTimeline(overlays: Overlay[], shots: Shot[], cuts: Cut[], assetUrl: (id: string) => string): OverlayProps[] {
  return overlays
    .filter((o) => o.enabled && isBroll(shots.find((s) => s.id === o.shotId)))
    .flatMap((o) => {
      const range = toOutput(o.startMs, o.endMs, cuts);
      if (!range) return [];
      const { id, media, placement, transition, durationMs } = o;
      return [{ id, src: assetUrl(o.assetId), media, ...range, placement, transition, ...(durationMs ? { durationMs } : {}) }];
    })
    .sort((a, b) => a.startMs - b.startMs);
}

export function motionGraphicTimeline(mgs: MotionGraphic[], cuts: Cut[], assetUrl: (id: string) => string): MotionGraphicProps[] {
  return mgs.filter((m) => m.enabled).flatMap((m) => {
    const range = toOutput(m.startMs, m.endMs, cuts);
    if (!range) return [];
    const props = Object.fromEntries(m.props.map((p) => [p.key, p.type === "image" ? assetUrl(p.value) : p.value]));
    return [{ id: m.id, compiled: m.compiled, ...range, box: m.box, props }];
  });
}
