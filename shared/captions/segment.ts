import { TL_NO_STRAND, isTagalog, normWord } from "../lang/tagalog";
import type { CaptionLayout, Phrase, Word } from "../types";

const endsSentence = (w: Word) => /[.?!]["')]?$/.test(w.text);

// Pure: words → phrases (pages) with line breaks, driven by the template layout. In Tagalog a break never strands a
// particle (ng, sa, ang, mga…) at a line end: it moves before the particle when the particle and its word fit on one line.
export function segmentCaptions(words: Word[], layout: CaptionLayout, language?: string | null): Phrase[] {
  const phrases: Phrase[] = [];
  let cur: Phrase | null = null;
  let lineChars = 0, lineWords = 0, lines = 0;
  const tl = isTagalog(language);
  const strandedBefore = (w: Word): Word | null => {
    const last = cur!.words.at(-1)!;
    const fits = last.text.length + 1 + w.text.length <= layout.maxCharsPerLine && layout.maxWordsPerLine >= 2;
    return tl && lineWords > 1 && TL_NO_STRAND.has(normWord(last.text)) && fits ? last : null;
  };

  for (const w of words) {
    const prev = cur?.words.at(-1);
    if (!cur || !prev || w.startMs - prev.endMs >= layout.pauseSplitMs || endsSentence(prev)) {
      if (cur) phrases.push(cur);
      cur = { id: `ph-${phrases.length}`, startMs: w.startMs, endMs: w.endMs, words: [w], lineBreaksAfter: [] };
      lineChars = w.text.length; lineWords = 1; lines = 1;
      continue;
    }
    const fits = lineChars + 1 + w.text.length <= layout.maxCharsPerLine && lineWords + 1 <= layout.maxWordsPerLine;
    const particle = fits ? null : strandedBefore(w);
    if (!fits && lines + 1 > layout.maxLines) {
      if (particle) {
        cur.words.pop();
        cur.endMs = cur.words.at(-1)!.endMs;
      }
      phrases.push(cur);
      const first = particle ?? w;
      cur = { id: `ph-${phrases.length}`, startMs: first.startMs, endMs: w.endMs, words: particle ? [particle, w] : [w], lineBreaksAfter: [] };
      lineChars = particle ? particle.text.length + 1 + w.text.length : w.text.length; lineWords = particle ? 2 : 1; lines = 1;
      continue;
    }
    if (!fits) {
      cur.lineBreaksAfter.push(cur.words.length - (particle ? 2 : 1));
      lineChars = particle ? particle.text.length + 1 + w.text.length : w.text.length; lineWords = particle ? 2 : 1; lines++;
    } else {
      lineChars += 1 + w.text.length; lineWords++;
    }
    cur.words.push(w);
    cur.endMs = w.endMs;
    if (w.text.length > layout.maxCharsPerLine) lineChars = Number.MAX_SAFE_INTEGER; // overlong word owns its line
  }
  if (cur) phrases.push(cur);
  return phrases;
}

// After a re-segment each emoji follows its old phrase's first word.
export function carryEmoji(prev: Phrase[], next: Phrase[]): Phrase[] {
  const byWord = new Map(prev.flatMap((p) => (p.emoji ? [[p.words[0].id, p.emoji] as const] : [])));
  return next.map((p) => {
    const emoji = p.words.map((w) => byWord.get(w.id)).find(Boolean);
    return emoji ? { ...p, emoji } : p;
  });
}
