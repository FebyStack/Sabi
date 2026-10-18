import { useEffect, useState } from "react";
import type { Phrase } from "@shared/types";

// Text edits only; the server keeps timings. Same word count → keep word timings; otherwise spread the phrase span by character length.
export function retimePhrase(phrase: Phrase, text: string): Phrase {
  const texts = text.trim().split(/\s+/).filter(Boolean);
  if (texts.length === phrase.words.length) return { ...phrase, words: phrase.words.map((w, i) => ({ ...w, text: texts[i] })) };
  const total = texts.reduce((n, t) => n + t.length, 0) || 1;
  let cur = phrase.startMs;
  const words = texts.map((t, i) => {
    const d = ((phrase.endMs - phrase.startMs) * t.length) / total;
    const w = { id: `${phrase.id}-w${i}`, text: t, startMs: Math.round(cur), endMs: Math.round(cur + d) };
    cur += d;
    return w;
  });
  return { ...phrase, words, lineBreaksAfter: phrase.lineBreaksAfter.filter((i) => i < words.length - 1) };
}

// A cleared textarea deletes the caption.
export const applyPhraseEdits = (phrases: Phrase[], texts: string[]) =>
  phrases.map((p, i) => retimePhrase(p, texts[i] ?? "")).filter((p) => p.words.length > 0);

export function PhraseEditor({ phrases, busy, onApply }: { phrases: Phrase[]; busy: boolean; onApply: (phrases: Phrase[]) => void }) {
  const [texts, setTexts] = useState<string[]>([]);
  useEffect(() => setTexts(phrases.map((p) => p.words.map((w) => w.text).join(" "))), [phrases]);
  const dirty = texts.some((t, i) => t !== phrases[i]?.words.map((w) => w.text).join(" "));

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-neutral-300">Captions</h2>
      <ul className="space-y-2">
        {phrases.map((p, i) => (
          <li key={p.id} className="flex gap-2">
            <span className="w-14 shrink-0 pt-3 text-xs text-neutral-500">{(p.startMs / 1000).toFixed(1)}s</span>
            <textarea className="min-h-11 flex-1 rounded-md bg-neutral-800 px-3 py-2" rows={2} value={texts[i] ?? ""} onChange={(e) => setTexts((t) => t.map((x, j) => (j === i ? e.target.value : x)))} />
          </li>
        ))}
      </ul>
      <button className="min-h-11 rounded-md bg-white px-4 font-medium text-black disabled:opacity-50" disabled={!dirty || busy} onClick={() => onApply(applyPhraseEdits(phrases, texts))}>
        Apply edits
      </button>
    </section>
  );
}
