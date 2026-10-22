import type { Project } from "@shared/types";
import type { Selected } from "../store/editorStore";
import type { Effect } from "./gestures";
import { blocks, dragBounds, dragToActions } from "./layout";

const STEP_MS = 100, BIG_STEP_MS = 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ←/→ nudge the selection (Shift: 1 s): overlays/MGs and phrases move whole, a shot moves its end edge. Delete asks to remove a layer.
export function keyToEffect(key: string, shift: boolean, selected: Selected | null, project: Project): Effect | "play" | null {
  if (key === " ") return "play";
  if (key === "Escape") return { type: "select", selected: null };
  if (!selected) return null;
  if (key === "Delete" || key === "Backspace") {
    return selected.kind === "overlay" || selected.kind === "mg" ? { type: "delete", selected } : null; // the selection bar asks first
  }
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const block = blocks(project).find((b) => b.id === selected.id && b.kind === selected.kind);
  if (!block) return null;
  const delta = (key === "ArrowLeft" ? -1 : 1) * (shift ? BIG_STEP_MS : STEP_MS);
  if (block.kind === "shot") {
    if (!block.handles.includes("end")) return null;
    const { minMs, maxMs } = dragBounds(project, block, "end");
    const endMs = clamp(block.endMs + delta, minMs, maxMs);
    return endMs === block.endMs ? null : { type: "commit", actions: dragToActions(block, block.startMs, endMs) };
  }
  if (block.kind === "cut") return null;
  const { minMs, maxMs } = dragBounds(project, block, "move");
  const startMs = clamp(block.startMs + delta, minMs, maxMs);
  return startMs === block.startMs ? null : { type: "commit", actions: dragToActions(block, startMs, startMs + block.endMs - block.startMs) };
}
