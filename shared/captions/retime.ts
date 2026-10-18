import type { Phrase } from "../types";

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
