const STAGES = ["extract-audio", "transcribe", "segment", "render", "subtitles"] as const;
const LABEL: Record<(typeof STAGES)[number], string> = { "extract-audio": "Audio", transcribe: "Transcribing", segment: "Captions", render: "Rendering", subtitles: "Subtitles" };

export function StageProgress({ stage, progress }: { stage: string | null; progress: number }) {
  const current = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <ol className="flex gap-1 text-xs">
        {STAGES.map((s, i) => (
          <li key={s} className={`flex-1 rounded px-2 py-2 text-center ${i < current ? "bg-neutral-700" : i === current ? "bg-white text-black" : "bg-neutral-900 text-neutral-500"}`}>
            {LABEL[s]}
          </li>
        ))}
      </ol>
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-800"><div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} /></div>
      <p className="text-xs text-neutral-400">{progress}%</p>
    </div>
  );
}
