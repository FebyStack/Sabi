const CAPTION_STAGES = [["extract-audio", "Audio"], ["transcribe", "Transcribing"], ["segment", "Captions"], ["render", "Rendering"], ["subtitles", "Subtitles"]];
const PLAN_STAGES = [["plan", "Planning"], ["translate", "Translating"], ["render", "Rendering"], ["subtitles", "Subtitles"]];
const BROLL_STAGES = [["beats", "Beats"], ["label", "Describing"], ["fetch", "Fetching media"], ["render", "Rendering"], ["subtitles", "Subtitles"]];

export function StageProgress({ kind, stage, progress }: { kind: string | null; stage: string | null; progress: number }) {
  const stages = kind === "plan" ? PLAN_STAGES : kind === "broll" ? BROLL_STAGES : CAPTION_STAGES;
  const current = stages.findIndex(([s]) => s === stage);
  const pct = Math.round(progress);
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <ol className="flex gap-1 text-xs">
        {stages.map(([s, label], i) => (
          <li key={s} className={`flex-1 rounded px-2 py-2 text-center ${i < current ? "bg-neutral-700" : i === current ? "bg-white text-black" : "bg-neutral-900 text-neutral-500"}`}>
            {label}
          </li>
        ))}
      </ol>
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-800"><div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-neutral-400">{pct}%</p>
    </div>
  );
}
