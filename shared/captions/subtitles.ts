import type { Phrase } from "../types";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const stamp = (ms: number, sep: string) => {
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
};

export const phraseText = (p: Phrase) =>
  p.words.map((w, i) => w.text + (p.lineBreaksAfter.includes(i) ? "\n" : " ")).join("").trim();

const cues = (phrases: Phrase[], sep: string) =>
  phrases.map((p, i) => `${i + 1}\n${stamp(p.startMs, sep)} --> ${stamp(p.endMs, sep)}\n${phraseText(p)}\n`).join("\n");

export const toSrt = (phrases: Phrase[]) => cues(phrases, ",");
export const toVtt = (phrases: Phrase[]) => "WEBVTT\n" + (phrases.length ? "\n" + cues(phrases, ".") : "");
