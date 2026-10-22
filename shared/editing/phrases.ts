import type { EmphasisKind, Phrase } from "../types";

// New phrase span; word times follow linearly from the old span (rounded). Ids, breaks and emoji are kept.
export function scalePhrase(p: Phrase, startMs: number, endMs: number): Phrase {
  const k = (endMs - startMs) / (p.endMs - p.startMs || 1);
  const at = (ms: number) => Math.round(startMs + (ms - p.startMs) * k);
  return { ...p, startMs, endMs, words: p.words.map((w) => ({ ...w, startMs: at(w.startMs), endMs: at(w.endMs) })) };
}

export function setEmphasis(p: Phrase, wordId: string, emphasis: EmphasisKind | null): Phrase {
  return {
    ...p,
    words: p.words.map((w) => {
      if (w.id !== wordId) return w;
      const { emphasis: _e, ...rest } = w;
      return emphasis ? { ...rest, emphasis } : rest;
    }),
  };
}
