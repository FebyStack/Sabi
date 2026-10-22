import { MIN_PHRASE_MS, MIN_SHOT_MS } from "@shared/contract";
import { MIN_LAYER_MS, staleOverlays } from "@shared/editing/overlays";
import type { Action, Project, ShotKind } from "@shared/types";
import type { Selected } from "../store/editorStore";

// The timeline draws source time; pure, so the node tests cover it without a DOM.
export const TRACKS = ["shots", "cuts", "captions", "broll", "mg"] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_H = 44, HANDLE_HIT_PX = 44, MIN_BLOCK_PX = 8, SNAP_PX = 8, BASE_PX_PER_SEC = 60;
export const ZOOM = { min: 0.25, max: 8 };
export const msToPx = (ms: number, zoom: number) => (ms / 1000) * BASE_PX_PER_SEC * zoom;
export const pxToMs = (px: number, zoom: number) => (px / (BASE_PX_PER_SEC * zoom)) * 1000;

export type Handle = "start" | "end" | "move";
export type Block = { track: Track; kind: Selected["kind"]; id: string; startMs: number; endMs: number; label: string; tone: string; handles: Handle[]; muted: boolean };

export const TRACK_LABEL: Record<Track, string> = { shots: "Shots", cuts: "Cuts", captions: "Captions", broll: "B-roll", mg: "Motion graphics" };
const ITEM_LABEL: Record<Track, string> = { shots: "Shot", cuts: "Cut", captions: "Caption", broll: "B-roll", mg: "Motion graphic" };
const SHOT_TONE: Record<ShotKind, string> = { Hook: "bg-shot-hook", "Talking Head": "bg-shot-th", "B-Roll": "bg-shot-broll", "Talking Head & B-Roll": "bg-shot-thb" };
export const mss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
export const blockLabel = (b: Block) => `${ITEM_LABEL[b.track]} ${b.label} ${mss(b.startMs)}–${mss(b.endMs)}`;

export function blocks(project: Project): Block[] {
  const shots = project.editPlan?.shots ?? [];
  const stale = new Set(staleOverlays(project));
  return [
    ...shots.map((s, i): Block => ({
      track: "shots", kind: "shot", id: s.id, startMs: s.startMs, endMs: s.endMs, label: s.kind, tone: SHOT_TONE[s.kind], muted: false,
      handles: [...(i > 0 ? ["start" as const] : []), ...(i < shots.length - 1 ? ["end" as const] : [])],
    })),
    ...(project.editPlan?.cuts ?? []).map((c): Block => ({
      track: "cuts", kind: "cut", id: c.id, startMs: c.startMs, endMs: c.endMs, label: c.reason === "pause" ? "Pause" : `“${c.text}”`, tone: "bg-cut", handles: [], muted: !c.shouldTrim,
    })),
    ...project.phrases.map((p): Block => ({
      track: "captions", kind: "phrase", id: p.id, startMs: p.startMs, endMs: p.endMs, label: p.words.slice(0, 3).map((w) => w.text).join(" "), tone: "bg-caption", handles: ["start", "end"], muted: false,
    })),
    ...project.overlays.map((o): Block => ({
      track: "broll", kind: "overlay", id: o.id, startMs: o.startMs, endMs: o.endMs, label: o.query || o.source, tone: "bg-overlay", handles: ["start", "end", "move"], muted: !o.enabled || stale.has(o.id),
    })),
    ...project.motionGraphics.map((m): Block => ({
      track: "mg", kind: "mg", id: m.id, startMs: m.startMs, endMs: m.endMs, label: m.name, tone: "bg-mg", handles: ["start", "end", "move"], muted: !m.enabled,
    })),
  ];
}

// Where the moved edge (or the block start, for move) may go; the server rejects the same limits from any client.
export function dragBounds(project: Project, block: Block, handle: Handle): { minMs: number; maxMs: number } {
  const fixed = { minMs: handle === "end" ? block.endMs : block.startMs, maxMs: handle === "end" ? block.endMs : block.startMs };
  const len = block.endMs - block.startMs;
  const dur = project.sourceDurationMs ?? block.endMs;
  const inside = (lo: number, hi: number) =>
    handle === "start" ? { minMs: lo, maxMs: block.endMs - MIN_LAYER_MS } : handle === "end" ? { minMs: block.startMs + MIN_LAYER_MS, maxMs: hi } : { minMs: lo, maxMs: hi - len };
  if (block.kind === "shot") {
    const shots = project.editPlan?.shots ?? [];
    const i = shots.findIndex((s) => s.id === block.id);
    if (handle === "start" && i > 0) return { minMs: shots[i - 1].startMs + MIN_SHOT_MS, maxMs: block.endMs - MIN_SHOT_MS };
    if (handle === "end" && i >= 0 && i < shots.length - 1) return { minMs: block.startMs + MIN_SHOT_MS, maxMs: shots[i + 1].endMs - MIN_SHOT_MS };
    return fixed;
  }
  if (block.kind === "phrase") {
    const i = project.phrases.findIndex((p) => p.id === block.id);
    const prev = project.phrases[i - 1], next = project.phrases[i + 1];
    if (handle === "start") return { minMs: prev?.endMs ?? 0, maxMs: block.endMs - MIN_PHRASE_MS };
    if (handle === "end") return { minMs: block.startMs + MIN_PHRASE_MS, maxMs: next?.startMs ?? dur };
    return { minMs: prev?.endMs ?? 0, maxMs: (next?.startMs ?? dur) - len };
  }
  if (block.kind === "overlay") {
    const o = project.overlays.find((x) => x.id === block.id);
    const shot = project.editPlan?.shots.find((s) => s.id === o?.shotId);
    return shot ? inside(shot.startMs, shot.endMs) : fixed;
  }
  if (block.kind === "mg") return inside(0, dur);
  return fixed;
}

export function snapPoints(project: Project, exclude: Block): number[] {
  const edges = blocks(project).filter((b) => b.id !== exclude.id).flatMap((b) => [b.startMs, b.endMs]);
  return [...new Set(edges)].sort((a, b) => a - b);
}

// The nearest edge within SNAP_PX on screen, else ms unchanged.
export function snap(ms: number, points: number[], zoom: number): number {
  const reach = pxToMs(SNAP_PX, zoom);
  let best = ms, dist = reach;
  for (const p of points) if (Math.abs(p - ms) <= dist) { best = p; dist = Math.abs(p - ms); }
  return best;
}

export function dragToActions(block: Block, startMs: number, endMs: number): Action[] {
  const s = Math.round(startMs), e = Math.round(endMs);
  switch (block.kind) {
    case "shot": return [{ type: "setShotBounds", shotId: block.id, ...(s !== block.startMs ? { startMs: s } : {}), ...(e !== block.endMs ? { endMs: e } : {}) }];
    case "phrase": return [{ type: "retimePhraseRange", phraseId: block.id, startMs: s, endMs: e }];
    case "overlay": return [{ type: "setOverlay", overlayId: block.id, startMs: s, endMs: e }];
    case "mg": return [{ type: "updateMotionGraphic", mgId: block.id, startMs: s, endMs: e }];
    default: return [];
  }
}

export const blockWidthPx = (b: Block, zoom: number) => Math.max(MIN_BLOCK_PX, msToPx(b.endMs - b.startMs, zoom));
