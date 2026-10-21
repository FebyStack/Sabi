import type { Beat, Shot } from "../types";

export const BEAT_LEAD_MS = 300;
export const BEAT_MAX_MS = 5000;
export const BEAT_MIN_MS = 1500;

// One beat per B-roll shot, a little after the cut so the speaker's line lands first. Shots are contiguous, so beats never overlap.
// `allowVideo` is the labeler's call (it may upgrade one beat); every derived beat is an image.
export function deriveBeats(shots: Shot[], _opts: { allowVideo: boolean }): Beat[] {
  const beats: Beat[] = [];
  for (const s of shots) {
    if (s.kind !== "B-Roll" && s.kind !== "Talking Head & B-Roll") continue;
    const startMs = Math.max(0, s.startMs + BEAT_LEAD_MS);
    const length = Math.min(s.endMs - startMs, BEAT_MAX_MS);
    if (length < BEAT_MIN_MS) continue;
    beats.push({ id: `beat-${beats.length}`, shotId: s.id, startMs, endMs: startMs + length, placement: s.kind === "B-Roll" ? "full" : "top", media: "image" });
  }
  return beats;
}
