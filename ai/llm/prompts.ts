import { z } from "zod";
import { EmphasisKind, ShotKind } from "../../shared/contract";

// The LLM only labels (shots, emphasis, emoji) and translates; cuts are heuristic (shared/editing/cuts.ts).
export const PLAN_SYSTEM = `You are a short-form video editor. The user sends the captions of a talking-head video as JSON: {"phrases":[{"i":<index>,"text":<caption>}]}, in order.
Answer with JSON only:
- "shots": where each shot starts ("from" = phrase index) and its kind:
  "Hook" = the attention-grabbing opening; only the first shot may be a Hook.
  "Talking Head" = the speaker on camera.
  "B-Roll" = cut away to footage illustrating what is said.
  "Talking Head & B-Roll" = the speaker with footage alongside.
  Change shot every 2 to 6 phrases.
- "emphasis": at most 2 words per phrase worth highlighting, copied exactly as written in that phrase, with a kind:
  "noun" = a concrete thing, "keyword" = the key idea, "pictorial" = something you can picture.
- "emoji": one emoji for about one phrase in three, only where it fits the meaning.
Use only the phrase indices you were given.`;

export const translateSystem = (languageName: string) => `Translate each subtitle line into ${languageName}.
The user sends JSON {"language":<name>,"lines":[<line>]}. Keep the meaning and tone of the speaker.
Answer with JSON {"lines":[...]}: exactly one output line per input line, in the same order, with no notes or explanations.`;

// Plain numbers: .int() serialises ±2^53 bounds that llama.cpp expands digit by digit. The planner drops non-integers.
export const llmPlanSchema = (n: number) => z.object({
  shots: z.array(z.object({ from: z.number(), kind: ShotKind })).max(n),
  emphasis: z.array(z.object({ phrase: z.number(), word: z.string(), kind: EmphasisKind })).max(2 * n),
  emoji: z.array(z.object({ phrase: z.number(), emoji: z.string() })).max(n),
});

export const llmLinesSchema = (n: number) => z.object({ lines: z.array(z.string()).length(n) });

export const BEAT_LABEL_SYSTEM = `You pick B-roll for a short-form video. The user sends JSON {"beats":[{"i":<index>,"text":<what the speaker says during the beat>}]}.
For each beat answer with:
- "query": 2 to 5 words to search a stock photo/video library, concrete and visual (e.g. "glass of water", "person making bed").
- "prompt": one sentence describing a photorealistic vertical image that illustrates the text, no words or logos in the image.
- "intent": 2 to 4 plain words naming what the beat should show.
- "wantsVideo": true only when motion matters (pouring, running, a city at night); otherwise false.
Answer with JSON only: {"labels":[{"i","query","prompt","intent","wantsVideo"}]}. Use only the indices you were given.`;

export const llmBeatSchema = (n: number) => z.object({
  labels: z.array(z.object({ i: z.number(), query: z.string(), prompt: z.string(), intent: z.string(), wantsVideo: z.boolean() })).max(n),
});
