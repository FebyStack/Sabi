import { segmentCaptions } from "../../../shared/captions/segment";
import { getCaptionTemplate } from "../../../shared/captions/templates";
import type { Phrase } from "../../../shared/types";
import sample from "../../shared/fixtures/transcript-sample.json";
import { FakeLlm } from "../../shared/llm";
import { fakeLlmResponder } from "../../shared/testing";
import { planEdit, translatePhrases } from "./planner";

const phrases = segmentCaptions(sample.words, getCaptionTemplate("clean").layout);
const plan = (shots: unknown[], emphasis: unknown[] = [], emoji: unknown[] = []) => new FakeLlm(() => ({ shots, emphasis, emoji }));
// n phrases: the sample's 9 repeated, shifted one clip length per round, with fresh ids
const many = (n: number): Phrase[] => Array.from({ length: n }, (_, k) => {
  const p = phrases[k % phrases.length], off = Math.floor(k / phrases.length) * 21000;
  return { ...p, id: `ph-${k}`, startMs: p.startMs + off, endMs: p.endMs + off,
    words: p.words.map((w) => ({ ...w, id: `${w.id}-${k}`, startMs: w.startMs + off, endMs: w.endMs + off })) };
});

describe("planEdit", () => {
  it("uses the sample's nine phrases", () => {
    expect(phrases).toHaveLength(9);
    expect(phrases[2].startMs).toBe(4259);
  });

  it("turns llm shots into contiguous ms ranges covering the clip", async () => {
    const llm = plan([{ from: 0, kind: "Hook" }, { from: 2, kind: "Talking Head" }, { from: 4, kind: "B-Roll" }]);
    const { shots } = await planEdit(llm, phrases, 21000);
    expect(shots.map((s) => s.kind)).toEqual(["Hook", "Talking Head", "B-Roll"]);
    expect(shots[0]).toMatchObject({ id: "shot-0", startMs: 0, endMs: phrases[2].startMs });
    expect(shots.at(-1)!.endMs).toBe(21000);
    shots.slice(1).forEach((s, i) => expect(s.startMs).toBe(shots[i].endMs));
  });

  it("applies emphasis and emoji to the named phrases", async () => {
    const llm = plan([{ from: 0, kind: "Hook" }], [{ phrase: 0, word: "routines", kind: "pictorial" }], [{ phrase: 1, emoji: "🧘" }]);
    const out = await planEdit(llm, phrases, 21000);
    expect(out.phrases[0].words.find((w) => w.text === "routines.")?.emphasis).toBe("pictorial");
    expect(out.phrases[0].words.filter((w) => w.emphasis)).toHaveLength(1);
    expect(out.phrases[1].emoji).toBe("🧘");
  });

  it("clears emphasis and emoji from an earlier plan", async () => {
    const old = phrases.map((p) => ({ ...p, emoji: "🔥", words: p.words.map((w) => ({ ...w, emphasis: "noun" as const })) }));
    const out = await planEdit(plan([]), old, 21000);
    expect(out.phrases.some((p) => p.emoji || p.words.some((w) => w.emphasis))).toBe(false);
  });

  it("normalizes out-of-range llm output", async () => {
    const words0 = phrases[0].words.slice(0, 4).map((w) => ({ phrase: 0, word: w.text, kind: "keyword" }));
    const llm = plan(
      [{ from: 99, kind: "B-Roll" }, { from: 3, kind: "Hook" }, { from: 3, kind: "B-Roll" }],
      [{ phrase: 99, word: "Here", kind: "noun" }, { phrase: 0, word: "banana", kind: "noun" }, ...words0],
      [{ phrase: 0, emoji: "smile" }],
    );
    const out = await planEdit(llm, phrases, 21000);
    expect(out.shots).toEqual([{ id: "shot-0", kind: "Hook", startMs: 0, endMs: 21000 }]);
    expect(out.phrases[0].words.filter((w) => w.emphasis)).toHaveLength(2);
    expect(out.phrases[0].emoji).toBeUndefined();
  });

  it("ignores non-integer phrase indices", async () => {
    const llm = plan([{ from: 0, kind: "Hook" }, { from: 1.5, kind: "B-Roll" }], [{ phrase: 0.5, word: "Here", kind: "noun" }], [{ phrase: 1.5, emoji: "🔥" }]);
    const out = await planEdit(llm, phrases, 21000);
    expect(out.shots).toEqual([{ id: "shot-0", kind: "Hook", startMs: 0, endMs: 21000 }]);
    expect(out.phrases.some((p) => p.emoji || p.words.some((w) => w.emphasis))).toBe(false);
  });

  it("demotes a late Hook and merges equal neighbours", async () => {
    const llm = plan([{ from: 0, kind: "Talking Head" }, { from: 2, kind: "Talking Head" }, { from: 5, kind: "Hook" }]);
    const { shots } = await planEdit(llm, phrases, 21000);
    expect(shots).toEqual([{ id: "shot-0", kind: "Talking Head", startMs: 0, endMs: 21000 }]);
  });

  it("falls back to one Talking Head shot", async () => {
    const { shots } = await planEdit(plan([]), phrases, 1000);
    expect(shots).toEqual([{ id: "shot-0", kind: "Talking Head", startMs: 0, endMs: phrases.at(-1)!.endMs }]);
  });

  it("batches long transcripts with global phrase indices", async () => {
    const llm = new FakeLlm(fakeLlmResponder);
    const input = many(130);
    const out = await planEdit(llm, input, 7 * 21000);
    expect(llm.calls).toHaveLength(3);
    expect(JSON.parse(llm.calls[1].user).phrases[0].i).toBe(60);
    expect(out.phrases[60].emoji).toBe("🔥");
    expect(out.shots.find((s) => s.startMs === input[63].startMs)).toBeTruthy();
  });
});

describe("translatePhrases", () => {
  it("translates in batches and keeps phrase timing", async () => {
    const src = many(45).map((p, i) => (i === 0 ? { ...p, emoji: "🔥", words: p.words.map((w) => ({ ...w, emphasis: "noun" as const })) } : p));
    const llm = new FakeLlm(fakeLlmResponder);
    const out = await translatePhrases(llm, src, "es");
    expect(llm.calls).toHaveLength(2);
    expect(JSON.parse(llm.calls[0].user).language).toBe("Spanish");
    out.forEach((p, i) => expect([p.startMs, p.endMs]).toEqual([src[i].startMs, src[i].endMs]));
    expect(out[0].words.map((w) => w.text).join(" ")).toMatch(/^Spanish: /);
    expect(out[0].emoji).toBe("🔥");
    expect(out[0].lineBreaksAfter).toEqual([]);

    const same = await translatePhrases(new FakeLlm((req) => ({ lines: JSON.parse(req.user).lines })), src.slice(0, 1), "es");
    expect(same[0].words.map((w) => [w.startMs, w.endMs])).toEqual(src[0].words.map((w) => [w.startMs, w.endMs]));
    expect(same[0].words.some((w) => w.emphasis)).toBe(false);
  });

  it("fails with llm_invalid_output when a batch returns the wrong line count", async () => {
    await expect(translatePhrases(new FakeLlm(() => ({ lines: ["x"] })), phrases.slice(0, 3), "es")).rejects.toThrow("llm_invalid_output");
  });
});
