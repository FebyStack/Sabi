import { BEAT_LABEL_SYSTEM, llmBeatSchema } from "../../../ai/llm/prompts";
import type { Beat, Phrase } from "../../../shared/types";
import { PLAN_BATCH } from "../editplan/planner";
import { askJson, type Llm } from "../../shared/llm";

export type LabeledBeat = Beat & { query: string; prompt: string; intent: string };

const clean = (s: string, max: number) => s.replace(/["'`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();

// What is said during the beat (source time), from the caption words.
const spokenDuring = (b: Beat, phrases: Phrase[]) =>
  phrases.flatMap((p) => p.words).filter((w) => w.startMs < b.endMs && w.endMs > b.startMs).map((w) => w.text).join(" ").slice(0, 240);

// The LLM only describes each beat; a sloppy answer is clamped or replaced by the beat's own words, never trusted.
export async function labelBeats(llm: Llm, beats: Beat[], phrases: Phrase[], opts: { allowVideo: boolean }): Promise<LabeledBeat[]> {
  const texts = beats.map((b) => spokenDuring(b, phrases));
  const labels = new Map<number, { query: string; prompt: string; intent: string; wantsVideo: boolean }>();
  for (let from = 0; from < beats.length; from += PLAN_BATCH) {
    const batch = texts.slice(from, from + PLAN_BATCH).map((text, j) => ({ i: from + j, text }));
    const { labels: got } = await askJson(llm, llmBeatSchema(batch.length), BEAT_LABEL_SYSTEM, { beats: batch });
    for (const l of got) if (Number.isInteger(l.i) && l.i >= 0 && l.i < beats.length && !labels.has(l.i)) labels.set(l.i, l);
  }
  let videoUsed = !opts.allowVideo;
  return beats.map((b, i) => {
    const words = texts[i].split(" ").slice(0, 6).join(" ");
    const l = labels.get(i);
    const query = clean(l?.query ?? "", 60) || clean(words, 60);
    const media = !videoUsed && l?.wantsVideo ? ((videoUsed = true), "video" as const) : "image" as const;
    return { ...b, media, query, prompt: clean(l?.prompt ?? "", 600) || `photo of ${words}`.slice(0, 600), intent: clean(l?.intent ?? "", 200) || clean(words, 200) };
  });
}
