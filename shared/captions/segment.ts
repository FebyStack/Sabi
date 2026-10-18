import type { CaptionLayout, Phrase, Word } from "../types";

const endsSentence = (w: Word) => /[.?!]["')]?$/.test(w.text);

// Pure: words → phrases (pages) with line breaks, driven only by the template layout.
export function segmentCaptions(words: Word[], layout: CaptionLayout): Phrase[] {
  const phrases: Phrase[] = [];
  let cur: Phrase | null = null;
  let lineChars = 0, lineWords = 0, lines = 0;

  for (const w of words) {
    const prev = cur?.words.at(-1);
    if (!cur || !prev || w.startMs - prev.endMs >= layout.pauseSplitMs || endsSentence(prev)) {
      if (cur) phrases.push(cur);
      cur = { id: `ph-${phrases.length}`, startMs: w.startMs, endMs: w.endMs, words: [w], lineBreaksAfter: [] };
      lineChars = w.text.length; lineWords = 1; lines = 1;
      continue;
    }
    const fits = lineChars + 1 + w.text.length <= layout.maxCharsPerLine && lineWords + 1 <= layout.maxWordsPerLine;
    if (!fits && lines + 1 > layout.maxLines) {
      phrases.push(cur);
      cur = { id: `ph-${phrases.length}`, startMs: w.startMs, endMs: w.endMs, words: [w], lineBreaksAfter: [] };
      lineChars = w.text.length; lineWords = 1; lines = 1;
      continue;
    }
    if (!fits) {
      cur.lineBreaksAfter.push(cur.words.length - 1);
      lineChars = w.text.length; lineWords = 1; lines++;
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
