import { useEffect, useRef, useState } from "react";
import type { Action, EmphasisKind, Phrase, Project } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useEditorStore, type EditorStore } from "../store/editorStore";

const textOf = (p: Phrase) => p.words.map((w) => w.text).join(" ");
const clean = (t: string) => t.trim().split(/\s+/).filter(Boolean).join(" ");
const at = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, "0")}`;
const CYCLE: (EmphasisKind | null)[] = [null, "keyword", "noun", "pictorial"];
const EMPHASIS_TONE: Record<EmphasisKind, string> = { keyword: "bg-accent text-accent-ink", noun: "bg-shot-broll text-surface-0", pictorial: "bg-ok text-surface-0" };

// One editPhrase per phrase whose text changed; an emptied text is not a delete (trim the phrase on the timeline instead).
export function phraseEdits(phrases: Phrase[], texts: Record<string, string>): Action[] {
  return phrases.flatMap((p) => {
    const t = texts[p.id] === undefined ? null : clean(texts[p.id]);
    return t && t !== textOf(p) ? [{ type: "editPhrase" as const, phraseId: p.id, text: t }] : [];
  });
}
// After a project change, a draft survives unless its phrase is gone or its saved text changed (an edit landed, here or from the agent).
export function keepDrafts(prev: Phrase[], next: Phrase[], texts: Record<string, string>): Record<string, string> {
  const before = new Map(prev.map((p) => [p.id, textOf(p)]));
  const after = new Map(next.map((p) => [p.id, textOf(p)]));
  return Object.fromEntries(Object.entries(texts).filter(([id]) => after.has(id) && after.get(id) === before.get(id)));
}
export const nextEmphasis = (e: EmphasisKind | undefined) => CYCLE[(CYCLE.indexOf(e ?? null) + 1) % CYCLE.length];

type Props = { project: Project; store: EditorStore; commit: (actions: Action[]) => Promise<void>; busy: boolean; onGenerate: () => void };

export function CaptionsPanel({ project, store, commit, busy, onGenerate }: Props) {
  const selected = useEditorStore(store, (s) => (s.selection?.kind === "phrase" ? s.selection.id : null));
  const [texts, setTexts] = useState<Record<string, string>>({});
  const shown = useRef(project.phrases);
  useEffect(() => { // a word-chip or emoji tap must not wipe a sentence being typed
    setTexts((t) => keepDrafts(shown.current, project.phrases, t));
    shown.current = project.phrases;
  }, [project.phrases]);
  useEffect(() => { if (selected) document.getElementById(`phrase-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [selected]);
  if (!project.phrases.length) return <Notice tone="info" action={{ label: "Generate captions", onClick: onGenerate }}>No captions yet.</Notice>;
  const edits = phraseEdits(project.phrases, texts);

  return (
    <section className="space-y-3">
      <ul className="space-y-2">
        {project.phrases.map((p) => {
          const draft = texts[p.id] ?? textOf(p);
          return (
            <li key={p.id} id={`phrase-${p.id}`} aria-current={p.id === selected || undefined}
              className={`space-y-2 rounded-3 p-2 ${p.id === selected ? "bg-surface-2 ring-1 ring-accent" : "bg-surface-1"}`}>
              <div className="flex gap-2">
                <span className="w-12 shrink-0 pt-3 text-xs tabular-nums text-ink-muted">{at(p.startMs)}</span>
                <textarea aria-label={`Caption at ${at(p.startMs)}`} rows={2} value={draft} disabled={busy}
                  onFocus={() => store.set({ selection: { kind: "phrase", id: p.id } })}
                  onChange={(e) => setTexts((t) => ({ ...t, [p.id]: e.target.value }))}
                  className="min-h-11 flex-1 rounded-2 bg-surface-2 px-3 py-2 text-base" />
                <input aria-label="Emoji" maxLength={16} defaultValue={p.emoji ?? ""} key={`${p.id}:${p.emoji ?? ""}`} disabled={busy}
                  onBlur={(e) => { const emoji = e.target.value.trim() || null; if (emoji !== (p.emoji ?? null)) void commit([{ type: "setPhraseEmoji", phraseId: p.id, emoji }]); }}
                  className="min-h-11 w-14 shrink-0 rounded-2 bg-surface-2 text-center text-lg" />
              </div>
              {!clean(draft) && <p className="text-xs text-warn">Captions can't be empty — trim the phrase on the timeline instead.</p>}
              <div className="flex flex-wrap gap-1 pl-14">
                {p.words.map((w) => (
                  <button key={w.id} type="button" aria-label={`${w.text}: ${w.emphasis ?? "none"}`} aria-pressed={!!w.emphasis} disabled={busy}
                    onClick={() => commit([{ type: "setWordEmphasis", phraseId: p.id, wordId: w.id, emphasis: nextEmphasis(w.emphasis) }])}
                    className={`min-h-11 rounded-2 px-3 text-sm ${w.emphasis ? EMPHASIS_TONE[w.emphasis] : "bg-surface-2 text-ink-muted"}`}>
                    {w.text}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-muted">Tap a word to cycle its highlight: keyword → noun → pictorial → none.</p>
      <Button variant="primary" disabled={!edits.length || busy} onClick={() => void commit(edits)}>Apply text edits</Button>
    </section>
  );
}
