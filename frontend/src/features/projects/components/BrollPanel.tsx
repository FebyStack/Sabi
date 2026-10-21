import { useState } from "react";
import { staleOverlays } from "@shared/editing/overlays";
import type { Action, BrollInput, MediaSource, Overlay, Project, Shot } from "@shared/types";
import { assetFileUrl, uploadFile } from "../api/projects";

const STEP_MS = 500;
const REPLACE_TYPES = ["image/png", "image/jpeg", "image/webp", "video/mp4"];
const mss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const range = (a: number, b: number) => `${mss(a)}–${mss(b)}`;

export const STALE_NOTICE = "Project changed elsewhere — reloaded, try again";
export const actionErrorNotice = (e: Error) => (e.message === "stale" ? STALE_NOTICE : null);

export function overlayRows(project: Project): { overlay: Overlay; shot: Shot | undefined; label: string; stale: boolean }[] {
  const stale = new Set(staleOverlays(project));
  return project.overlays.map((overlay) => {
    const shot = project.editPlan?.shots.find((s) => s.id === overlay.shotId);
    return { overlay, shot, label: `${shot?.kind ?? "Shot removed"} · ${range(overlay.startMs, overlay.endMs)}`, stale: stale.has(overlay.id) };
  });
}

type Props = {
  project: Project; busy: boolean; notice: string | null;
  onMediaSource: (m: MediaSource) => void; onAdd: (input: BrollInput) => void; onActions: (actions: Action[]) => void; onSeek: (ms: number) => void;
};

// B-roll and motion graphics, mobile-first. Every edit goes through the actions API (the same path the agent uses).
export function BrollPanel({ project, busy, notice, onMediaSource, onAdd, onActions, onSeek }: Props) {
  const [replaceAll, setReplaceAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = overlayRows(project);
  const notFound = project.warnings.filter((w) => w.startsWith("broll_not_found:")).length;
  const button = "min-h-11 rounded-md px-4 font-medium disabled:opacity-50";
  const small = "min-h-11 min-w-11 rounded-md bg-neutral-800 px-3 text-sm disabled:opacity-40";

  const replace = async (o: Overlay, file: File | undefined) => {
    if (!file) return;
    if (!REPLACE_TYPES.includes(file.type)) return setError("Replace with a PNG, JPEG, WebP or MP4 file.");
    setError(null);
    try {
      const asset = await uploadFile(file, () => {}, project.id);
      onActions([{ type: "replaceOverlay", overlayId: o.id, assetId: asset.id }]);
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-neutral-300">B-roll</h2>
      <div role="group" aria-label="Media source" className="grid grid-cols-2 gap-1 rounded-md bg-neutral-900 p-1">
        {([["generate", "Generate (fal.ai)"], ["stock", "Stock only"]] as const).map(([m, label]) => (
          <button key={m} type="button" aria-pressed={project.mediaSource === m} disabled={busy} onClick={() => project.mediaSource !== m && onMediaSource(m)}
            className={`min-h-11 rounded px-3 text-sm disabled:opacity-50 ${project.mediaSource === m ? "bg-white text-black" : ""}`}>{label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className={`${button} bg-white text-black`} disabled={busy} onClick={() => onAdd({ regenerate: replaceAll })}>
          {project.overlays.length ? "Refresh B-roll" : "Add B-roll"}
        </button>
        {project.overlays.length > 0 && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} /> Replace existing
          </label>
        )}
      </div>
      {project.warnings.includes("no_broll_shots") && <p className="text-sm text-amber-400">Mark shots as B-Roll in the edit plan first.</p>}
      {notFound > 0 && <p className="text-sm text-amber-400">No media found for {notFound} beat(s).</p>}
      {notice && <p className="text-sm text-amber-400" role="status">{notice}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map(({ overlay: o, shot, label, stale }) => {
            const set = (patch: Omit<Extract<Action, { type: "setOverlay" }>, "type" | "overlayId">) => onActions([{ type: "setOverlay", overlayId: o.id, ...patch }]);
            const longer = shot ? Math.min(shot.endMs, o.endMs + STEP_MS) : o.endMs;
            const shorter = Math.max(o.startMs + STEP_MS, o.endMs - STEP_MS);
            return (
              <li key={o.id} className="space-y-2 rounded-md bg-neutral-900 p-2">
                <div className="flex items-center gap-3">
                  <button type="button" aria-label={`Play ${label}`} className="size-16 shrink-0 overflow-hidden rounded bg-black" onClick={() => onSeek(o.startMs)}>
                    {o.media === "image"
                      ? <img src={assetFileUrl(o.assetId)} alt="" className="size-full object-cover" />
                      : <video src={assetFileUrl(o.assetId)} muted className="size-full object-cover" />}
                  </button>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate tabular-nums">{label}</p>
                    {stale && <p className="text-xs text-amber-400">shot changed — refresh</p>}
                    {o.attribution && <a className="text-xs text-neutral-400 underline" href={o.attribution.url} target="_blank" rel="noreferrer">Photo: {o.attribution.author} / Pexels</a>}
                    {o.source === "generated" && <p className="text-xs text-neutral-400">Generated (fal.ai)</p>}
                  </div>
                  <input type="checkbox" role="switch" aria-label={`Show ${label}`} className="size-6" checked={o.enabled} disabled={busy} onChange={(e) => set({ enabled: e.target.checked })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Placement" className="min-h-11 rounded-md bg-neutral-800 px-3 text-sm" value={o.placement} disabled={busy}
                    onChange={(e) => set({ placement: e.target.value as Overlay["placement"] })}>
                    <option value="full">Full</option>
                    <option value="top">Top</option>
                  </select>
                  <button type="button" aria-label="End −0.5 s" className={small} disabled={busy || o.endMs - o.startMs <= STEP_MS} onClick={() => set({ endMs: shorter })}>−0.5 s</button>
                  <button type="button" aria-label="End +0.5 s" className={small} disabled={busy || !shot || o.endMs >= shot.endMs} onClick={() => set({ endMs: longer })}>+0.5 s</button>
                  <label className={`${small} content-center ${busy ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
                    Replace
                    <input type="file" accept={REPLACE_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => replace(o, e.target.files?.[0])} />
                  </label>
                  <button type="button" className={small} disabled={busy} onClick={() => onAdd({ overlayId: o.id })}>Another</button>
                  <button type="button" className={small} disabled={busy} onClick={() => onActions([{ type: "removeOverlay", overlayId: o.id }])}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {project.motionGraphics.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-neutral-300">Motion graphics</h3>
          <ul className="space-y-1">
            {project.motionGraphics.map((m) => (
              <li key={m.id} className="flex min-h-11 items-center gap-3 rounded-md bg-neutral-900 px-3 text-sm">
                <button type="button" className="min-h-11 flex-1 text-left tabular-nums" onClick={() => onSeek(m.startMs)}>{m.name} · {range(m.startMs, m.endMs)}</button>
                <input type="checkbox" role="switch" aria-label={`Show ${m.name}`} className="size-6" checked={m.enabled} disabled={busy}
                  onChange={(e) => onActions([{ type: "updateMotionGraphic", mgId: m.id, enabled: e.target.checked }])} />
                <button type="button" className={small} disabled={busy} onClick={() => onActions([{ type: "removeMotionGraphic", mgId: m.id }])}>Delete</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {project.creditsUsedCents > 0 && <p className="text-xs text-neutral-400">${(project.creditsUsedCents / 100).toFixed(2)} used</p>}
    </section>
  );
}
