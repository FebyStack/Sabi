import type { Phrase } from "../types";

export const phraseAt = (phrases: Phrase[], timeMs: number): Phrase | null =>
  phrases.find((p) => timeMs >= p.startMs && timeMs < p.endMs) ?? null;

// -1 before the first word starts; otherwise the index of the last word that has started.
export function activeWordIndex(phrase: Phrase, timeMs: number): number {
  let idx = -1;
  for (let i = 0; i < phrase.words.length; i++) if (timeMs >= phrase.words[i].startMs) idx = i;
  return idx;
}
