import type { Action } from "@shared/types";
import type { Selected } from "../store/editorStore";
import { ZOOM, dragToActions, pxToMs, type Block, type Handle, type Track } from "./layout";

// A reducer over pointer events, no DOM. x is in timeline-content px (scroll included), so x ↔ ms is pxToMs(x, zoom).
export type Pointer = { id: number; x: number; y: number };
export type Hit = { block: Block; handle: Handle } | { track: Track; ms: number }; // a block/handle, or empty track space
export type GestureEvent = { type: "down"; pointer: Pointer; hit: Hit } | { type: "move"; pointer: Pointer } | { type: "up"; pointerId: number } | { type: "cancel"; pointerId: number };
export type GestureState = {
  pointers: Pointer[]; mode: "idle" | "pending" | "drag" | "pinch" | "pan";
  drag?: { block: Block; handle: Handle; originX: number; startMs: number; endMs: number; cur: { startMs: number; endMs: number } };
  pinch?: { startDist: number; startZoom: number; anchorMs: number }; pendingHit?: Hit;
};
export type Effect = { type: "preview"; actions: Action[] } | { type: "commit"; actions: Action[] } | { type: "select"; selected: Selected | null } | { type: "seek"; ms: number }
  | { type: "zoom"; zoom: number; anchorMs: number } | { type: "pan"; dx: number } | { type: "clear" } | { type: "delete"; selected: Selected };
export type GestureCtx = { zoom: number; bounds: (b: Block, h: Handle) => { minMs: number; maxMs: number }; snap: (ms: number) => number };
export const SLOP_PX = 6;

const IDLE: GestureState = { pointers: [], mode: "idle" };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Pointer, b: Pointer) => Math.hypot(a.x - b.x, a.y - b.y);
const tap = (hit: Hit): Effect[] => ("block" in hit
  ? [{ type: "select", selected: { kind: hit.block.kind, id: hit.block.id } }, { type: "seek", ms: hit.block.startMs }]
  : [{ type: "seek", ms: hit.ms }, { type: "select", selected: null }]);

// The dragged range: the moved edge (or both, for move) through snap, then clamped to the bounds.
function dragRange(d: NonNullable<GestureState["drag"]>, x: number, ctx: GestureCtx) {
  const dms = pxToMs(x - d.originX, ctx.zoom);
  const { minMs, maxMs } = ctx.bounds(d.block, d.handle);
  if (d.handle === "start") return { startMs: clamp(ctx.snap(d.startMs + dms), minMs, maxMs), endMs: d.endMs };
  if (d.handle === "end") return { startMs: d.startMs, endMs: clamp(ctx.snap(d.endMs + dms), minMs, maxMs) };
  const len = d.endMs - d.startMs;
  const byStart = ctx.snap(d.startMs + dms), byEnd = ctx.snap(d.endMs + dms) - len, raw = d.startMs + dms;
  const start = clamp(Math.abs(byEnd - raw) < Math.abs(byStart - raw) ? byEnd : byStart, minMs, maxMs);
  return { startMs: start, endMs: start + len };
}

export function reduceGesture(state: GestureState, e: GestureEvent, ctx: GestureCtx): { state: GestureState; effects: Effect[] } {
  if (e.type === "cancel") return { state: IDLE, effects: state.mode === "idle" ? [] : [{ type: "clear" }] };

  if (e.type === "down") {
    if (state.pointers.length === 1 && state.mode !== "idle") {
      const [a, b] = [state.pointers[0], e.pointer];
      const pinch = { startDist: dist(a, b) || 1, startZoom: ctx.zoom, anchorMs: pxToMs((a.x + b.x) / 2, ctx.zoom) };
      return { state: { pointers: [a, b], mode: "pinch", pinch }, effects: [{ type: "clear" }] };
    }
    if (state.pointers.length) return { state, effects: [] }; // a third finger, or one left over from a pinch
    return { state: { pointers: [e.pointer], mode: "pending", pendingHit: e.hit }, effects: [] };
  }

  if (e.type === "move") {
    const i = state.pointers.findIndex((p) => p.id === e.pointer.id);
    if (i < 0) return { state, effects: [] };
    if (state.mode === "pinch" && state.pinch) {
      const pointers = state.pointers.map((p, j) => (j === i ? e.pointer : p));
      const zoom = clamp((state.pinch.startZoom * dist(pointers[0], pointers[1])) / state.pinch.startDist, ZOOM.min, ZOOM.max);
      return { state: { ...state, pointers }, effects: [{ type: "zoom", zoom, anchorMs: state.pinch.anchorMs }] };
    }
    if (state.mode === "pan") {
      const dx = e.pointer.x - state.pointers[0].x;
      return { state: { ...state, pointers: [e.pointer] }, effects: dx ? [{ type: "pan", dx }] : [] };
    }
    if (state.mode === "drag" && state.drag) {
      const cur = dragRange(state.drag, e.pointer.x, ctx);
      return { state: { ...state, drag: { ...state.drag, cur } }, effects: [{ type: "preview", actions: dragToActions(state.drag.block, cur.startMs, cur.endMs) }] };
    }
    if (state.mode === "pending" && state.pendingHit) {
      const down = state.pointers[0];
      if (Math.abs(e.pointer.x - down.x) <= SLOP_PX) return { state, effects: [] };
      const hit = state.pendingHit;
      if ("block" in hit && hit.block.handles.includes(hit.handle)) {
        const { block, handle } = hit;
        const d = { block, handle, originX: down.x, startMs: block.startMs, endMs: block.endMs, cur: { startMs: block.startMs, endMs: block.endMs } };
        const cur = dragRange(d, e.pointer.x, ctx);
        return { state: { pointers: [down], mode: "drag", drag: { ...d, cur } }, effects: [{ type: "preview", actions: dragToActions(block, cur.startMs, cur.endMs) }] };
      }
      // Empty space or a block that cannot move: the swipe scrolls the timeline (tracks are touch-action: pan-y).
      return { state: { pointers: [e.pointer], mode: "pan" }, effects: [{ type: "pan", dx: e.pointer.x - down.x }] };
    }
    return { state, effects: [] };
  }

  // up
  const rest = state.pointers.filter((p) => p.id !== e.pointerId);
  if (state.mode === "pinch") return { state: rest.length ? { pointers: rest, mode: "idle" } : IDLE, effects: rest.length ? [] : [{ type: "clear" }] };
  if (state.mode === "drag" && state.drag) {
    const { block, cur } = state.drag;
    const select: Effect = { type: "select", selected: { kind: block.kind, id: block.id } };
    const changed = Math.round(cur.startMs) !== block.startMs || Math.round(cur.endMs) !== block.endMs;
    return { state: IDLE, effects: changed ? [{ type: "commit", actions: dragToActions(block, cur.startMs, cur.endMs) }, { type: "clear" }, select] : [{ type: "clear" }, ...tap({ block, handle: state.drag.handle })] };
  }
  if (state.mode === "pending" && state.pendingHit) return { state: IDLE, effects: tap(state.pendingHit) };
  return { state: IDLE, effects: [] };
}
