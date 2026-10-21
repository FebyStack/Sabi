import { Link } from "react-router";
import { SHOT_KINDS } from "@shared/contract";
import type { Action, BrollInput, Overlay, Project, ShotKind } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import type { Selected } from "../store/editorStore";
import { blocks, dragBounds, dragToActions, mss } from "./layout";

const STEP_MS = 500;

// The end edge ±0.5 s inside its bounds (precise nudging for blocks too narrow to drag on a phone); null at the bound.
export function nudgeEnd(project: Project, selected: Selected, deltaMs: number): Action[] | null {
  const b = blocks(project).find((x) => x.id === selected.id && x.kind === selected.kind);
  if (!b || !b.handles.includes("end")) return null;
  const { minMs, maxMs } = dragBounds(project, b, "end");
  const endMs = Math.min(maxMs, Math.max(minMs, b.endMs + deltaMs));
  if (endMs === b.endMs) return null;
  return b.kind === "overlay" ? [{ type: "setOverlay", overlayId: b.id, endMs }] : dragToActions(b, b.startMs, endMs);
}

type Props = {
  project: Project; selected: Selected; commit: (actions: Action[]) => Promise<void>; onAdd: (input: BrollInput) => void;
  confirming: boolean; onConfirming: (open: boolean) => void; // the "Delete?" sheet, also opened by Delete/Backspace on the timeline
};

export function SelectionBar({ project, selected, commit, onAdd, confirming: confirm, onConfirming: setConfirm }: Props) {
  const b = blocks(project).find((x) => x.id === selected.id && x.kind === selected.kind);
  if (!b) return null;
  const nudges = (
    <>
      {[-STEP_MS, STEP_MS].map((d) => {
        const actions = nudgeEnd(project, selected, d);
        return <Button key={d} size="sm" aria-label={`End ${d < 0 ? "−" : "+"}0.5 s`} disabled={!actions} onClick={() => actions && commit(actions)}>{d < 0 ? "−" : "+"}0.5 s</Button>;
      })}
    </>
  );
  const remove = (what: string, action: Action) => (
    <>
      <Button size="sm" variant="danger" aria-label={`Delete ${b.label}`} aria-haspopup="dialog" onClick={() => setConfirm(true)}>Delete</Button>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={`Delete this ${what}?`}>
        <p className="mb-4 text-sm text-ink-muted">This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => { setConfirm(false); void commit([action]); }}>Delete</Button>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      </Sheet>
    </>
  );

  let controls = null;
  if (b.kind === "shot") {
    const kind = project.editPlan!.shots.find((s) => s.id === b.id)!.kind;
    controls = <Segmented<ShotKind> label="Shot kind" value={kind} options={SHOT_KINDS.map((k) => ({ value: k, label: k }))} onChange={(k) => commit([{ type: "setShotKind", shotId: b.id, kind: k }])} />;
  } else if (b.kind === "cut") {
    const cut = project.editPlan!.cuts.find((c) => c.id === b.id)!;
    controls = <Switch label={cut.reason === "pause" ? "Cut this pause" : `Cut “${cut.text}”`} checked={cut.shouldTrim} onChange={(on) => commit([{ type: "setCut", cutId: cut.id, shouldTrim: on }])} />;
  } else if (b.kind === "phrase") {
    controls = <><Link to="?tab=captions" className="grid min-h-11 place-items-center rounded-2 bg-surface-2 px-3 text-sm">Edit text</Link>{nudges}</>;
  } else if (b.kind === "overlay") {
    const o = project.overlays.find((x) => x.id === b.id)!;
    controls = (
      <>
        <Switch label={`Show ${b.label}`} checked={o.enabled} onChange={(on) => commit([{ type: "setOverlay", overlayId: o.id, enabled: on }])} />
        <Segmented<Overlay["placement"]> label="Placement" value={o.placement} options={[{ value: "full", label: "Full" }, { value: "top", label: "Top" }]}
          onChange={(placement) => commit([{ type: "setOverlay", overlayId: o.id, placement }])} />
        {nudges}
        <Button size="sm" onClick={() => onAdd({ overlayId: o.id })}>Another</Button>
        {remove("B-roll", { type: "removeOverlay", overlayId: o.id })}
      </>
    );
  } else {
    const m = project.motionGraphics.find((x) => x.id === b.id)!;
    controls = (
      <>
        <Switch label={`Show ${b.label}`} checked={m.enabled} onChange={(on) => commit([{ type: "updateMotionGraphic", mgId: m.id, enabled: on }])} />
        {remove("motion graphic", { type: "removeMotionGraphic", mgId: m.id })}
      </>
    );
  }

  return (
    <section aria-label="Selection" className="space-y-2 rounded-3 bg-surface-1 p-2">
      <p className="text-sm"><span className="font-medium">{b.label}</span> <span className="tabular-nums text-ink-muted">{mss(b.startMs)}–{mss(b.endMs)}</span></p>
      <div className="flex flex-wrap items-center gap-2">{controls}</div>
    </section>
  );
}
