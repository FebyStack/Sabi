import { useState } from "react";
import { staleOverlays } from "@shared/editing/overlays";
import type { Action, BrollInput, MediaSource, Overlay, Project, Shot } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { assetFileUrl, uploadFile } from "@/features/projects/api/projects";

const REPLACE_TYPES = ["image/png", "image/jpeg", "image/webp", "video/mp4"];
const mss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const range = (a: number, b: number) => `${mss(a)}–${mss(b)}`;
const SOURCES: { value: MediaSource; label: string }[] = [{ value: "generate", label: "Generate (fal.ai)" }, { value: "stock", label: "Stock only" }];

export function overlayRows(project: Project): { overlay: Overlay; shot: Shot | undefined; label: string; stale: boolean }[] {
  const stale = new Set(staleOverlays(project));
  return project.overlays.map((overlay) => {
    const shot = project.editPlan?.shots.find((s) => s.id === overlay.shotId);
    return { overlay, shot, label: `${shot?.kind ?? "Shot removed"} · ${range(overlay.startMs, overlay.endMs)}`, stale: stale.has(overlay.id) };
  });
}

type Props = { project: Project; busy: boolean; onAdd: (input: BrollInput) => void; commit: (actions: Action[]) => Promise<void>; onSeek: (ms: number) => void };

// B-roll and motion graphics, mobile-first; every edit is an action (timing lives on the timeline and its selection bar).
export function BrollPanel({ project, busy, onAdd, commit, onSeek }: Props) {
  const [replaceAll, setReplaceAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; action: Action } | null>(null);
  const rows = overlayRows(project);
  const notFound = project.warnings.filter((w) => w.startsWith("broll_not_found:")).length;

  const replace = async (o: Overlay, file: File | undefined) => {
    if (!file) return;
    if (!REPLACE_TYPES.includes(file.type)) return setError("Replace with a PNG, JPEG, WebP or MP4 file.");
    setError(null);
    try {
      const asset = await uploadFile(file, () => {}, project.id);
      await commit([{ type: "replaceOverlay", overlayId: o.id, assetId: asset.id }]);
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    }
  };
  const del = (label: string, title: string, action: Action) => (
    <Button size="sm" variant="danger" aria-label={`Delete ${label}`} aria-haspopup="dialog" disabled={busy} onClick={() => setConfirm({ title, action })}>Delete</Button>
  );

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-ink-muted">B-roll</h2>
      <Segmented label="Media source" value={project.mediaSource} options={SOURCES} disabled={busy} onChange={(m) => commit([{ type: "setMediaSource", mediaSource: m }])} />
      {!project.editPlan ? <Notice tone="info">Plan the edit first — B-roll goes on the shots it labels.</Notice> : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy} onClick={() => onAdd({ regenerate: replaceAll })}>{project.overlays.length ? "Refresh B-roll" : "Add B-roll"}</Button>
          {project.overlays.length > 0 && <label className="flex min-h-11 items-center gap-2 text-sm"><Switch label="Replace existing" checked={replaceAll} onChange={setReplaceAll} /> Replace existing</label>}
        </div>
      )}
      {project.warnings.includes("no_broll_shots") && <Notice tone="warn">Mark shots as B-Roll in the edit plan first.</Notice>}
      {notFound > 0 && <Notice tone="warn">No media found for {notFound} beat(s).</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map(({ overlay: o, label, stale }) => (
            <li key={o.id} className="space-y-2 rounded-3 bg-surface-1 p-2">
              <div className="flex items-center gap-3">
                <button type="button" aria-label={`Play ${label}`} className="size-16 shrink-0 overflow-hidden rounded-2 bg-black" onClick={() => onSeek(o.startMs)}>
                  {o.media === "image"
                    ? <img src={assetFileUrl(o.assetId)} alt="" className="size-full object-cover" />
                    : <video src={assetFileUrl(o.assetId)} muted className="size-full object-cover" />}
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate tabular-nums">{label}</p>
                  {stale && <p className="text-xs text-warn">shot changed — refresh</p>}
                  {o.attribution && <a className="text-xs text-ink-muted underline" href={o.attribution.url} target="_blank" rel="noreferrer">Photo: {o.attribution.author} / Pexels</a>}
                  {o.source === "generated" && <p className="text-xs text-ink-muted">Generated (fal.ai)</p>}
                </div>
                <Switch label={`Show ${label}`} checked={o.enabled} disabled={busy} onChange={(on) => commit([{ type: "setOverlay", overlayId: o.id, enabled: on }])} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Segmented<Overlay["placement"]> label="Placement" value={o.placement} disabled={busy} options={[{ value: "full", label: "Full" }, { value: "top", label: "Top" }]}
                  onChange={(placement) => commit([{ type: "setOverlay", overlayId: o.id, placement }])} />
                <label className={`grid min-h-11 place-items-center rounded-2 bg-surface-2 px-3 text-sm ${busy ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
                  Replace
                  <input type="file" accept={REPLACE_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => replace(o, e.target.files?.[0])} />
                </label>
                <Button size="sm" disabled={busy} onClick={() => onAdd({ overlayId: o.id })}>Another</Button>
                {del(label, "Delete this B-roll?", { type: "removeOverlay", overlayId: o.id })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {project.motionGraphics.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-ink-muted">Motion graphics</h3>
          <ul className="space-y-1">
            {project.motionGraphics.map((m) => (
              <li key={m.id} className="flex min-h-11 items-center gap-2 rounded-2 bg-surface-1 pl-3 text-sm">
                <button type="button" className="min-h-11 flex-1 text-left tabular-nums" onClick={() => onSeek(m.startMs)}>{m.name} · {range(m.startMs, m.endMs)}</button>
                <Switch label={`Show ${m.name}`} checked={m.enabled} disabled={busy} onChange={(on) => commit([{ type: "updateMotionGraphic", mgId: m.id, enabled: on }])} />
                {del(m.name, "Delete this motion graphic?", { type: "removeMotionGraphic", mgId: m.id })}
              </li>
            ))}
          </ul>
        </>
      )}
      {project.creditsUsedCents > 0 && <p className="text-xs text-ink-muted">${(project.creditsUsedCents / 100).toFixed(2)} used</p>}
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? "Delete?"}>
        <p className="mb-4 text-sm text-ink-muted">This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => { if (confirm) void commit([confirm.action]); setConfirm(null); }}>Delete</Button>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      </Sheet>
    </section>
  );
}
