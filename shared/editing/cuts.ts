import type { Cut, Phrase, Word } from "../types";

export const PAUSE_MIN_MS = 600;
export const PAUSE_PAD_MS = 150;
export type Segment = { startMs: number; endMs: number };

const FILLERS = new Set(["um", "uh", "umm", "uhm", "erm", "er", "ah", "hmm", "mm"]);
const isFiller = (w: Word) => FILLERS.has(w.text.toLowerCase().replace(/[^\p{L}]/gu, ""));

// Heuristic, never the LLM: ASR gaps > 600 ms (padded 150 ms next to speech) and filler words, all enabled by default.
export function detectCuts(words: Word[], durationMs: number): Cut[] {
  if (!words.some((w) => !isFiller(w))) return []; // never cut the whole clip
  const found: Omit<Cut, "id">[] = [];
  const pause = (from: number, to: number, padStart: number, padEnd: number) => {
    if (to - from > PAUSE_MIN_MS) found.push({ startMs: from + padStart, endMs: to - padEnd, reason: "pause", text: "", shouldTrim: true });
  };
  pause(0, words[0].startMs, 0, PAUSE_PAD_MS);
  words.forEach((w, i) => {
    if (isFiller(w)) found.push({ startMs: w.startMs, endMs: w.endMs, reason: "filler", text: w.text, shouldTrim: true });
    const next = words[i + 1];
    if (next) pause(w.endMs, next.startMs, PAUSE_PAD_MS, PAUSE_PAD_MS);
    else pause(w.endMs, durationMs, PAUSE_PAD_MS, 0);
  });
  return found.map((c, i) => ({ id: `cut-${i}`, ...c }));
}

// Enabled cuts, sorted and merged.
function removed(cuts: Cut[]): Segment[] {
  const out: Segment[] = [];
  for (const c of cuts.filter((c) => c.shouldTrim).sort((a, b) => a.startMs - b.startMs)) {
    const last = out.at(-1);
    if (last && c.startMs <= last.endMs) last.endMs = Math.max(last.endMs, c.endMs);
    else out.push({ startMs: c.startMs, endMs: c.endMs });
  }
  return out;
}

export function keptSegments(durationMs: number, cuts: Cut[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const r of removed(cuts)) {
    if (r.startMs > at) out.push({ startMs: at, endMs: Math.min(r.startMs, durationMs) });
    at = Math.max(at, r.endMs);
  }
  if (durationMs > at) out.push({ startMs: at, endMs: durationMs });
  return out.filter((s) => s.endMs > s.startMs);
}

// Source → output ms; a time inside a cut maps to the cut's start.
export function mapTime(ms: number, cuts: Cut[]): number {
  return ms - removed(cuts).reduce((sum, r) => sum + Math.max(0, Math.min(ms, r.endMs) - r.startMs), 0);
}

export function applyCuts(phrases: Phrase[], cuts: Cut[], dropCutWords = true): Phrase[] {
  const gone = removed(cuts);
  const isCut = (w: Word) => dropCutWords && gone.some((r) => w.startMs >= r.startMs && w.endMs <= r.endMs);
  return phrases.flatMap((p) => {
    const kept = p.words.map((w, i) => ({ w, i })).filter(({ w }) => !isCut(w));
    const startMs = mapTime(p.startMs, cuts), endMs = mapTime(p.endMs, cuts);
    if (!kept.length || endMs <= startMs) return []; // a fully cut phrase would be a zero-length cue
    // A line break after a dropped word moves to the last kept word before it.
    const breaks = [...new Set(p.lineBreaksAfter.map((b) => kept.filter(({ i }) => i <= b).length - 1))].filter((b) => b >= 0 && b < kept.length - 1);
    return [{
      ...p, startMs, endMs, lineBreaksAfter: breaks,
      words: kept.map(({ w }) => ({ ...w, startMs: mapTime(w.startMs, cuts), endMs: mapTime(w.endMs, cuts) })),
    }];
  });
}
