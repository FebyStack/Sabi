import { useState } from "react";
import { LANGUAGE_NAMES, SHOT_KINDS } from "@shared/contract";
import type { Action, Cut, PlanInput, Project, Services, ShotKind, TranslationLanguage } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Switch } from "@/components/ui/Switch";

const KIND_TONE: Record<ShotKind, string> = { Hook: "bg-shot-hook", "Talking Head": "bg-shot-th", "B-Roll": "bg-shot-broll", "Talking Head & B-Roll": "bg-shot-thb" };
const LANGUAGES = Object.keys(LANGUAGE_NAMES) as TranslationLanguage[];
const at = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
const cutLabel = (c: Cut) =>
  c.reason === "pause" ? `Cut pause ${((c.endMs - c.startMs) / 1000).toFixed(1)} s at ${at(c.startMs)}` : `Cut “${c.text}” at ${at(c.startMs)}`;
const select = "min-h-11 flex-1 rounded-2 bg-surface-2 px-3";

type Props = { project: Project; busy: boolean; onPlan: (input: PlanInput) => void; commit: (actions: Action[]) => Promise<void>; onSeek: (ms: number) => void; services?: Services };

// The "Plan edit" job (Ollama) plus the plan's cuts and burn-in, each committed at once. Shots are edited on the timeline.
export function PlanPanel({ project, busy, onPlan, commit, onSeek, services }: Props) {
  const plan = project.editPlan;
  const [replan, setReplan] = useState(false);
  const [langs, setLangs] = useState<TranslationLanguage[]>([]);
  const [burnIn, setBurnIn] = useState<TranslationLanguage | null>(null);

  if (!plan || replan) {
    const toggle = (l: TranslationLanguage) => {
      setLangs((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]));
      if (burnIn === l) setBurnIn(null);
    };
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink-muted">Edit plan</h2>
        <p className="text-sm text-ink-muted">Finds pauses and filler words to cut, labels shots, highlights key words and adds emoji.</p>
        <fieldset>
          <legend className="mb-2 text-sm">Translate subtitles (up to 3)</legend>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.filter((l) => l !== project.language).map((l) => {
              const on = langs.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on} disabled={!on && langs.length >= 3} onClick={() => toggle(l)}
                  className={`min-h-11 rounded-4 px-4 text-sm disabled:opacity-40 ${on ? "bg-accent text-accent-ink" : "bg-surface-2"}`}>
                  {LANGUAGE_NAMES[l]}
                </button>
              );
            })}
          </div>
        </fieldset>
        {langs.length > 0 && (
          <Field label="Burn in">
            <select className={select} value={burnIn ?? ""} onChange={(e) => setBurnIn((e.target.value || null) as TranslationLanguage | null)}>
              <option value="">None</option>
              {langs.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
            </select>
          </Field>
        )}
        {services?.ollama === "down" && <Notice tone="warn">Ollama isn't running — start it with npm run ai:ollama.</Notice>}
        {services?.ollama === "model_missing" && <Notice tone="warn">Ollama has no {services.ollamaModel} — run ollama pull {services.ollamaModel}.</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => { onPlan({ languages: langs, burnInLanguage: burnIn }); setReplan(false); }}>Plan edit</Button>
          {plan && <Button onClick={() => setReplan(false)}>Cancel</Button>}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-ink-muted">Edit plan</h2>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
        {SHOT_KINDS.map((k) => <li key={k} className="flex items-center gap-1"><span className={`size-3 rounded-1 ${KIND_TONE[k]}`} />{k}</li>)}
        <li className="flex items-center gap-1"><span className="h-3 w-1 bg-cut" />Cut</li>
      </ul>
      <p className="text-xs text-ink-muted">Tap a shot on the timeline to change its kind; B-Roll shots get media on the next Add B-roll.</p>
      {plan.cuts.length > 0 ? (
        <ul className="space-y-1">
          {plan.cuts.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center gap-2 rounded-2 bg-surface-1 pl-3 text-sm">
              <button type="button" className="min-h-11 flex-1 text-left tabular-nums" onClick={() => onSeek(c.startMs)}>{cutLabel(c).replace(/^Cut /, "")}</button>
              <Switch label={cutLabel(c)} checked={c.shouldTrim} disabled={busy} onChange={(on) => commit([{ type: "setCut", cutId: c.id, shouldTrim: on }])} />
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-muted">No pauses or filler words to cut.</p>}
      {project.translations.length > 0 && (
        <Field label="Burned-in captions">
          <select aria-label="Burn in" className={select} disabled={busy} value={project.burnInLanguage ?? ""}
            onChange={(e) => commit([{ type: "setBurnIn", language: (e.target.value || null) as TranslationLanguage | null }])}>
            <option value="">Original captions</option>
            {project.translations.map((t) => <option key={t.language} value={t.language}>{LANGUAGE_NAMES[t.language]}</option>)}
          </select>
        </Field>
      )}
      <Button disabled={busy} onClick={() => { setLangs(project.translations.map((t) => t.language)); setBurnIn(project.burnInLanguage); setReplan(true); }}>Re-plan</Button>
    </section>
  );
}
