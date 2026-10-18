import type { z } from "zod";
import { PLAN_SYSTEM, llmLinesSchema, llmPlanSchema, translateSystem } from "../../../ai/llm/prompts";
import { retimePhrase } from "../../../shared/captions/retime";
import { LANGUAGE_NAMES } from "../../../shared/contract";
import type { Phrase, Shot, ShotKind, TranslationLanguage, Word } from "../../../shared/types";
import { askJson, type Llm } from "../../shared/llm";

export const PLAN_BATCH = 60;
export const TRANSLATE_BATCH = 40;

type LlmPlan = z.infer<ReturnType<typeof llmPlanSchema>>;

const textOf = (p: Phrase) => p.words.map((w) => w.text).join(" ");
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const plain = ({ emphasis: _, ...w }: Word): Word => w;
const batches = <T>(xs: T[], size: number) => Array.from({ length: Math.ceil(xs.length / size) }, (_, b) => xs.slice(b * size, (b + 1) * size));
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// LLM labels, then normalization: a small model's sloppy output is clamped or ignored, never trusted.
export async function planEdit(llm: Llm, phrases: Phrase[], durationMs: number): Promise<{ shots: Shot[]; phrases: Phrase[] }> {
  const answers: LlmPlan[] = [];
  for (const [b, batch] of batches(phrases, PLAN_BATCH).entries()) {
    const input = { phrases: batch.map((p, j) => ({ i: b * PLAN_BATCH + j, text: textOf(p) })) };
    answers.push(await askJson(llm, llmPlanSchema(batch.length), PLAN_SYSTEM, input));
  }
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < phrases.length;
  const out: Phrase[] = phrases.map(({ emoji: _, ...p }) => ({ ...p, words: p.words.map(plain) }));

  const flagged = new Map<number, number>();
  for (const e of answers.flatMap((a) => a.emphasis)) {
    const n = flagged.get(e.phrase) ?? 0;
    if (!inRange(e.phrase) || n >= 2 || !norm(e.word)) continue;
    const word = out[e.phrase].words.find((w) => !w.emphasis && norm(w.text) === norm(e.word));
    if (!word) continue;
    word.emphasis = e.kind;
    flagged.set(e.phrase, n + 1);
  }
  for (const e of answers.flatMap((a) => a.emoji)) {
    if (!inRange(e.phrase) || out[e.phrase].emoji) continue;
    const first = graphemes.segment(e.emoji.trim())[Symbol.iterator]().next().value?.segment;
    if (first && first.length <= 16 && /\p{Extended_Pictographic}/u.test(first)) out[e.phrase].emoji = first;
  }

  const starts: { from: number; kind: ShotKind }[] = [];
  let prevFrom = -1;
  for (const s of answers.flatMap((a) => a.shots).filter((s) => inRange(s.from)).sort((a, b) => a.from - b.from)) {
    if (s.from === prevFrom) continue; // first per phrase wins
    prevFrom = s.from;
    const kind = starts.length && s.kind === "Hook" ? "Talking Head" : s.kind; // Hook = the opening only
    if (starts.at(-1)?.kind === kind) continue;
    starts.push({ from: starts.length ? s.from : 0, kind });
  }
  if (!starts.length) starts.push({ from: 0, kind: "Talking Head" });
  const end = Math.max(durationMs, phrases.at(-1)?.endMs ?? 0);
  const startOf = (i: number) => (i === 0 ? 0 : phrases[starts[i].from].startMs);
  const shots = starts.map((s, i) => ({ id: `shot-${i}`, kind: s.kind, startMs: startOf(i), endMs: i + 1 < starts.length ? startOf(i + 1) : end }));

  return { shots, phrases: out };
}

// One output line per phrase; timings come from the source phrase. ja/zh have no spaces, so a phrase becomes one "word" (accepted).
export async function translatePhrases(llm: Llm, phrases: Phrase[], language: TranslationLanguage): Promise<Phrase[]> {
  const name = LANGUAGE_NAMES[language];
  const out: Phrase[] = [];
  for (const batch of batches(phrases, TRANSLATE_BATCH)) {
    const { lines } = await askJson(llm, llmLinesSchema(batch.length), translateSystem(name), { language: name, lines: batch.map(textOf) });
    batch.forEach((src, j) => {
      const t = retimePhrase({ ...src, lineBreaksAfter: [] }, lines[j].trim() || textOf(src));
      out.push({ ...t, words: t.words.map(plain) });
    });
  }
  return out;
}
