import type { Segment } from "../editing/cuts";
import type { CaptionTemplate, Phrase, Word } from "../types";

export const phraseAt = (phrases: Phrase[], timeMs: number): Phrase | null =>
  phrases.find((p) => timeMs >= p.startMs && timeMs < p.endMs) ?? null;

// -1 before the first word starts; otherwise the index of the last word that has started.
export function activeWordIndex(phrase: Phrase, timeMs: number): number {
  let idx = -1;
  for (let i = 0; i < phrase.words.length; i++) if (timeMs >= phrase.words[i].startMs) idx = i;
  return idx;
}

export const wordColor = (template: CaptionTemplate, word: Word, isActive: boolean): string =>
  template.animation === "karaoke" && isActive ? template.colors.activeWord : word.emphasis ? template.colors.emphasis[word.emphasis] : template.colors.text;

// Kept source segments → <Series.Sequence> frames. Boundaries round on the cumulative output timeline; the last uses the
// composition's own ceil so the sequences cover every frame up to its end.
export function segmentFrames(segments: Segment[], fps: number): { trimBefore: number; durationInFrames: number }[] {
  let outMs = 0, at = 0;
  return segments.flatMap((s, i) => {
    outMs += s.endMs - s.startMs;
    const end = i === segments.length - 1 ? Math.ceil((outMs / 1000) * fps) : Math.round((outMs * fps) / 1000);
    const durationInFrames = end - at;
    at = end;
    return durationInFrames > 0 ? [{ trimBefore: Math.round((s.startMs * fps) / 1000), durationInFrames }] : [];
  });
}
