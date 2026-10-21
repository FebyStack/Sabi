import { useRef, type PointerEvent, type WheelEvent } from "react";
import { toSourceTime } from "@shared/editing/cuts";
import { enabledCuts } from "@shared/editing/renderProps";
import type { Action, Cut, Project } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { previewOf } from "../actions/preview";
import { useEditorStore, type EditorStore } from "../store/editorStore";
import { reduceGesture, type Effect, type GestureState, type Hit } from "./gestures";
import { keyToEffect } from "./keyboard";
import {
  TRACKS, TRACK_H, TRACK_LABEL, ZOOM, blockLabel, blockWidthPx, blocks, dragBounds, msToPx, pxToMs, snap, snapPoints, type Block, type Handle, type Track,
} from "./layout";

type Props = { project: Project; store: EditorStore; commit: (actions: Action[]) => Promise<void>; onPlay: () => void; onSeek: (sourceMs: number) => void; onGenerate: () => void };

// Touch-first, in source time (enabled cuts shaded); the Player runs output time. Pointer events feed the pure gesture reducer.
export function Timeline({ project, store, commit, onPlay, onSeek, onGenerate }: Props) {
  const s = { // slices: the playhead has its own component, so playback does not re-render every block
    drag: useEditorStore(store, (x) => x.drag), zoom: useEditorStore(store, (x) => x.zoom),
    selection: useEditorStore(store, (x) => x.selection), changed: useEditorStore(store, (x) => x.changed),
  };
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<GestureState>({ pointers: [], mode: "idle" });
  const all = blocks(previewOf(project, s.drag));
  const committed = blocks(project);
  const cuts = enabledCuts(project);
  const durationMs = project.sourceDurationMs ?? Math.max(0, ...all.map((b) => b.endMs));
  const width = msToPx(durationMs, s.zoom);

  if (!project.phrases.length)
    return <Notice tone="info" action={{ label: "Generate captions", onClick: onGenerate }}>No captions yet — generate them to start editing.</Notice>;

  const contentX = (clientX: number) => clientX - (scroller.current?.getBoundingClientRect().left ?? 0) + (scroller.current?.scrollLeft ?? 0);
  const run = (effects: Effect[]) => {
    for (const e of effects) {
      if (e.type === "preview") store.set({ drag: { actions: e.actions } });
      else if (e.type === "clear") store.set({ drag: null });
      else if (e.type === "commit") void commit(e.actions);
      else if (e.type === "select") store.set({ selection: e.selected, deleting: false });
      else if (e.type === "delete") store.set({ selection: e.selected, deleting: true });
      else if (e.type === "seek") onSeek(e.ms);
      else if (e.type === "pan" && scroller.current) scroller.current.scrollLeft -= e.dx;
      else if (e.type === "zoom") {
        const el = scroller.current, before = store.get().zoom;
        const onScreen = el ? msToPx(e.anchorMs, before) - el.scrollLeft : 0; // keep the anchor under the fingers
        store.set({ zoom: e.zoom });
        if (el) requestAnimationFrame(() => { el.scrollLeft = msToPx(e.anchorMs, e.zoom) - onScreen; });
      }
    }
  };
  const feed = (e: Parameters<typeof reduceGesture>[1]) => {
    const pending = gesture.current.drag?.block ?? (gesture.current.pendingHit && "block" in gesture.current.pendingHit ? gesture.current.pendingHit.block : null);
    const points = pending ? snapPoints(project, pending) : [];
    const out = reduceGesture(gesture.current, e, {
      zoom: store.get().zoom, bounds: (b, h) => dragBounds(project, b, h), snap: (ms) => snap(ms, points, store.get().zoom),
    });
    gesture.current = out.state;
    run(out.effects);
  };
  const hitAt = (target: EventTarget, x: number): Hit | null => {
    const el = target as Element;
    const id = el.closest("[data-id]")?.getAttribute("data-id");
    const block = committed.find((b) => b.id === id);
    if (block) return { block, handle: (el.closest("[data-handle]")?.getAttribute("data-handle") as Handle | null) ?? "move" };
    const track = el.closest("[data-track]")?.getAttribute("data-track") as Track | null;
    return track ? { track, ms: Math.max(0, Math.min(durationMs, pxToMs(x, store.get().zoom))) } : null;
  };
  const pointer = (e: PointerEvent) => ({ id: e.pointerId, x: contentX(e.clientX), y: e.clientY });
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointer(e);
    const hit = hitAt(e.target, p.x);
    if (!hit) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer already ended */ }
    feed({ type: "down", pointer: p, hit });
  };
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return; // trackpad pinch / ctrl+wheel zooms on desktop
    e.preventDefault();
    const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, store.get().zoom * Math.exp(-e.deltaY / 200)));
    run([{ type: "zoom", zoom, anchorMs: pxToMs(contentX(e.clientX), store.get().zoom) }]);
  };
  const onKeyDown = (e: React.KeyboardEvent, b: Block) => {
    const effect = keyToEffect(e.key, e.shiftKey, store.get().selection ?? { kind: b.kind, id: b.id }, project);
    if (!effect) return;
    e.preventDefault();
    if (effect === "play") onPlay();
    else run([effect]);
  };
  const changed = new Set(s.changed?.ids ?? []);

  return (
    <div role="group" aria-label="Timeline" className="rounded-3 bg-surface-1">
      <div ref={scroller} className="relative overflow-x-auto overscroll-x-contain" style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown} onPointerMove={(e) => feed({ type: "move", pointer: pointer(e) })}
        onPointerUp={(e) => feed({ type: "up", pointerId: e.pointerId })} onPointerCancel={(e) => feed({ type: "cancel", pointerId: e.pointerId })} onWheel={onWheel}>
        <div className="relative select-none" style={{ width: Math.max(width, 1), minWidth: "100%" }}>
          <div aria-hidden className="relative h-6 border-b border-line text-[10px] text-ink-muted">
            {Array.from({ length: Math.floor(durationMs / 1000) + 1 }, (_, i) => (
              <span key={i} className={`absolute bottom-0 w-px bg-line ${i % 5 ? "h-1.5" : "h-3"}`} style={{ left: msToPx(i * 1000, s.zoom) }}>
                {i % 5 === 0 && <span className="absolute -top-2.5 left-1">{Math.floor(i / 60)}:{String(i % 60).padStart(2, "0")}</span>}
              </span>
            ))}
          </div>
          {TRACKS.map((t) => (
            <div key={t} role="list" aria-label={TRACK_LABEL[t]} data-track={t} className="relative border-b border-line/60" style={{ height: TRACK_H }}>
              {all.filter((b) => b.track === t).map((b) => (
                <div key={b.id} role="listitem" className="absolute inset-y-1" style={{ left: msToPx(b.startMs, s.zoom), width: blockWidthPx(b, s.zoom) }}>
                  <button type="button" data-id={b.id} aria-label={blockLabel(b)} aria-pressed={s.selection?.id === b.id}
                    onKeyDown={(e) => onKeyDown(e, b)} onFocus={() => store.get().selection?.id !== b.id && store.set({ selection: { kind: b.kind, id: b.id }, deleting: false })}
                    className={`relative size-full overflow-visible rounded-1 px-1 text-left text-[11px] leading-tight text-surface-0 ${b.tone} ${b.muted ? "opacity-40" : ""} ${s.selection?.id === b.id ? "ring-2 ring-ink" : ""} ${changed.has(b.id) ? "pulse" : ""}`}
                    style={{ width: blockWidthPx(b, s.zoom) }}>
                    <span className="block truncate">{b.label}</span>
                    {b.handles.includes("start") && <span data-handle="start" aria-hidden className="absolute inset-y-0 left-0 -mx-5 w-11" />}
                    {b.handles.includes("end") && <span data-handle="end" aria-hidden className="absolute inset-y-0 right-0 -mx-5 w-11" />}
                  </button>
                </div>
              ))}
            </div>
          ))}
          {cuts.map((c) => (
            <span key={c.id} data-cut-band aria-hidden className="pointer-events-none absolute bottom-0 top-6 bg-cut/30" style={{ left: msToPx(c.startMs, s.zoom), width: msToPx(c.endMs - c.startMs, s.zoom) }} />
          ))}
          <Playhead store={store} cuts={cuts} zoom={s.zoom} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 p-1 text-xs text-ink-muted">
        <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => store.set({ zoom: Math.max(ZOOM.min, s.zoom / 1.5) })}>−</Button>
        <span className="tabular-nums">{Math.round(s.zoom * 100)}%</span>
        <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => store.set({ zoom: Math.min(ZOOM.max, s.zoom * 1.5) })}>+</Button>
      </div>
    </div>
  );
}

// The Player runs output time; the playhead is drawn in source time.
function Playhead({ store, cuts, zoom }: { store: EditorStore; cuts: Cut[]; zoom: number }) {
  const ms = useEditorStore(store, (x) => x.playheadMs);
  return <span data-playhead aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: msToPx(toSourceTime(ms, cuts), zoom) }} />;
}
