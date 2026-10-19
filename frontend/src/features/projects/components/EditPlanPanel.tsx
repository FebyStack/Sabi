import { useEffect, useState } from "react";
import { LANGUAGE_NAMES, SHOT_KINDS } from "@shared/contract";
import type { Cut, PlanInput, Project, Shot, ShotKind, TranslationLanguage, UpdatePlanInput } from "@shared/types";

type Draft = { trim: Record<string, boolean>; kinds: Record<string, ShotKind>; burnIn?: TranslationLanguage | null };

const KIND_COLOR: Record<ShotKind, string> = { Hook: "bg-amber-500", "Talking Head": "bg-neutral-500", "B-Roll": "bg-sky-500", "Talking Head & B-Roll": "bg-violet-500" };
const LANGUAGES = Object.keys(LANGUAGE_NAMES) as TranslationLanguage[];
const at = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
const cutLabel = (c: Cut) =>
  c.reason === "pause" ? `Pause ${((c.endMs - c.startMs) / 1000).toFixed(1)} s at ${at(c.startMs)}` : `Filler “${c.text}” at ${at(c.startMs)}`;

export const shotLayout = (shots: Shot[], durationMs: number) =>
  shots.map((s) => ({ id: s.id, leftPct: (s.startMs / durationMs) * 100, widthPct: ((s.endMs - s.startMs) / durationMs) * 100 }));

// Only entries that differ from the saved plan; null when nothing does.
export function planChanges(project: Project, draft: Draft): UpdatePlanInput | null {
  const plan = project.editPlan;
  if (!plan) return null;
  const cuts = plan.cuts.filter((c) => c.id in draft.trim && draft.trim[c.id] !== c.shouldTrim).map((c) => ({ id: c.id, shouldTrim: draft.trim[c.id] }));
  const shots = plan.shots.filter((s) => s.id in draft.kinds && draft.kinds[s.id] !== s.kind).map((s) => ({ id: s.id, kind: draft.kinds[s.id] }));
  const burnIn = draft.burnIn !== undefined && draft.burnIn !== project.burnInLanguage;
  if (!cuts.length && !shots.length && !burnIn) return null;
  return { cuts, shots, ...(burnIn ? { burnInLanguage: draft.burnIn } : {}) };
}

type Props = { project: Project; busy: boolean; onPlan: (input: PlanInput) => void; onUpdate: (input: UpdatePlanInput) => void; onSeek: (ms: number) => void };

export function EditPlanPanel({ project, busy, onPlan, onUpdate, onSeek }: Props) {
  const plan = project.editPlan;
  const [replan, setReplan] = useState(false);
  const [langs, setLangs] = useState<TranslationLanguage[]>([]);
  const [burnIn, setBurnIn] = useState<TranslationLanguage | null>(null);
  const [draft, setDraft] = useState<Draft>({ trim: {}, kinds: {} });
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setDraft({ trim: {}, kinds: {} }); setReplan(false); }, [plan, project.burnInLanguage]);

  const button = "min-h-11 rounded-md px-4 font-medium disabled:opacity-50";
  const select = "min-h-11 flex-1 rounded-md bg-neutral-800 px-3";

  if (!plan || replan) {
    const toggle = (l: TranslationLanguage) => {
      setLangs((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]));
      if (burnIn === l) setBurnIn(null);
    };
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-300">Edit plan</h2>
        <p className="text-sm text-neutral-400">Finds pauses and filler words to cut, labels shots, highlights key words and adds emoji.</p>
        <fieldset>
          <legend className="mb-2 text-sm text-neutral-300">Translate subtitles (up to 3)</legend>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.filter((l) => l !== project.language).map((l) => {
              const on = langs.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on} disabled={!on && langs.length >= 3} onClick={() => toggle(l)}
                  className={`min-h-11 rounded-full px-4 text-sm disabled:opacity-40 ${on ? "bg-white text-black" : "bg-neutral-800"}`}>
                  {LANGUAGE_NAMES[l]}
                </button>
              );
            })}
          </div>
        </fieldset>
        {langs.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            Burn in
            <select className={select} value={burnIn ?? ""} onChange={(e) => setBurnIn((e.target.value || null) as TranslationLanguage | null)}>
              <option value="">None</option>
              {langs.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button className={`${button} bg-white text-black`} disabled={busy} onClick={() => onPlan({ languages: langs, burnInLanguage: burnIn })}>Plan edit</button>
          {plan && <button className={`${button} bg-neutral-800`} onClick={() => setReplan(false)}>Cancel</button>}
        </div>
      </section>
    );
  }

  const durationMs = plan.shots.at(-1)!.endMs; // shots cover the whole clip
  const layout = shotLayout(plan.shots, durationMs);
  const trimOf = (c: Cut) => draft.trim[c.id] ?? c.shouldTrim;
  const kindOf = (s: Shot) => draft.kinds[s.id] ?? s.kind;
  const changes = planChanges(project, draft);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-neutral-300">Edit plan</h2>
      <div className="relative h-11 w-full overflow-hidden rounded-md bg-neutral-900">
        {plan.shots.map((s, i) => (
          <button key={s.id} type="button" aria-label={`${kindOf(s)} shot at ${at(s.startMs)}`} aria-pressed={s.id === selected}
            className={`absolute inset-y-0 border-r border-neutral-950 ${KIND_COLOR[kindOf(s)]} ${s.id === selected ? "ring-2 ring-inset ring-white" : ""}`}
            style={{ left: `${layout[i].leftPct}%`, width: `${layout[i].widthPct}%` }}
            onClick={() => { setSelected(s.id); onSeek(s.startMs); }} />
        ))}
        {plan.cuts.filter(trimOf).map((c) => (
          <span key={c.id} className="pointer-events-none absolute inset-y-0 min-w-0.5 bg-red-500/80"
            style={{ left: `${(c.startMs / durationMs) * 100}%`, width: `${((c.endMs - c.startMs) / durationMs) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
        {SHOT_KINDS.map((k) => <li key={k} className="flex items-center gap-1"><span className={`size-3 rounded-sm ${KIND_COLOR[k]}`} />{k}</li>)}
        <li className="flex items-center gap-1"><span className="h-3 w-0.5 bg-red-500" />Cut</li>
      </ul>
      {/* The scrubber is the overview; short shots are too narrow to tap on a phone, so every shot also gets a ≥ 44 px row. */}
      <ul className="space-y-1">
        {plan.shots.map((s) => (
          <li key={s.id} className={`flex min-h-11 items-center gap-2 rounded-md pl-3 ${s.id === selected ? "bg-neutral-800" : "bg-neutral-900"}`}>
            <span className={`size-3 shrink-0 rounded-sm ${KIND_COLOR[kindOf(s)]}`} />
            <button type="button" className="min-h-11 min-w-16 text-left text-sm tabular-nums" onClick={() => { setSelected(s.id); onSeek(s.startMs); }}>
              {at(s.startMs)}
            </button>
            <select aria-label={`Shot at ${at(s.startMs)}`} className={select} value={kindOf(s)} disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, kinds: { ...d.kinds, [s.id]: e.target.value as ShotKind } }))}>
              {SHOT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {plan.cuts.length > 0 ? (
        <ul className="space-y-1">
          {plan.cuts.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-11 items-center gap-3 rounded-md bg-neutral-900 px-3 text-sm">
                <input type="checkbox" className="size-5" checked={trimOf(c)} disabled={busy}
                  onChange={(e) => setDraft((d) => ({ ...d, trim: { ...d.trim, [c.id]: e.target.checked } }))} />
                {cutLabel(c)}
              </label>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-neutral-400">No pauses or filler words to cut.</p>}
      {project.translations.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          Burn in
          <select className={select} disabled={busy} value={(draft.burnIn === undefined ? project.burnInLanguage : draft.burnIn) ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, burnIn: (e.target.value || null) as TranslationLanguage | null }))}>
            <option value="">Original captions</option>
            {project.translations.map((t) => <option key={t.language} value={t.language}>{LANGUAGE_NAMES[t.language]}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={`${button} bg-white text-black`} disabled={!changes || busy} onClick={() => changes && onUpdate(changes)}>Apply</button>
        <button className={`${button} bg-neutral-800`} disabled={busy}
          onClick={() => { setLangs(project.translations.map((t) => t.language)); setBurnIn(project.burnInLanguage); setReplan(true); }}>
          Re-plan
        </button>
      </div>
    </section>
  );
}
