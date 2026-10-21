import { STAGES, STAGE_LABELS, type Stage } from "./progressModel";

export function StageProgress({ view }: { view: { stage: Stage; pct: number } }) {
  const current = STAGES.indexOf(view.stage);
  return (
    <div className="space-y-2">
      <ol className="flex gap-1 text-[11px]">
        {STAGES.map((s, i) => (
          <li key={s} aria-current={i === current ? "step" : undefined}
            className={`flex-1 truncate rounded-1 px-1 py-1.5 text-center ${i < current ? "bg-surface-2 text-ink" : i === current ? "bg-accent text-accent-ink" : "bg-surface-1 text-ink-muted"}`}>
            {STAGE_LABELS[s]}
          </li>
        ))}
      </ol>
      <div className="h-1.5 w-full overflow-hidden rounded-1 bg-surface-2"><div className="h-full bg-accent transition-all duration-(--duration-slow)" style={{ width: `${view.pct}%` }} /></div>
      <p role="status" aria-live="polite" className="text-xs text-ink-muted">{STAGE_LABELS[view.stage]} {view.pct}%</p>
    </div>
  );
}
