import { segmentCaptions } from "./segment";
import type { CaptionLayout, Word } from "../types";

const w = (text: string, startMs: number, endMs: number, i: number): Word => ({ id: `w-${i}`, text, startMs, endMs });
// 12 words, ~250 ms each, one 900 ms pause before "You", a sentence end after "routines."
const words: Word[] = ["Here", "is", "the", "thing", "about", "morning", "routines.", "Most", "people", "think", "You", "need"]
  .map((t, i) => w(t, i * 300 + (i >= 10 ? 900 : 0), i * 300 + 250 + (i >= 10 ? 900 : 0), i));
const layout: CaptionLayout = { maxCharsPerLine: 24, maxWordsPerLine: 5, maxLines: 2, pauseSplitMs: 700 };

describe("segmentCaptions", () => {
  it("returns [] for no words", () => {
    expect(segmentCaptions([], layout)).toEqual([]);
  });

  it("splits on sentence punctuation", () => {
    const phrases = segmentCaptions(words.slice(0, 10), layout);
    expect(phrases.map((p) => p.words.map((x) => x.text).join(" "))).toEqual([
      "Here is the thing about morning routines.",
      "Most people think",
    ]);
    expect(phrases[0]).toMatchObject({ id: "ph-0", startMs: 0, endMs: 1 * 0 + 6 * 300 + 250 });
  });

  it("splits on a pause ≥ pauseSplitMs", () => {
    const phrases = segmentCaptions(words.slice(7), layout); // "Most people think" + pause + "You need"
    expect(phrases.map((p) => p.words.map((x) => x.text).join(" "))).toEqual(["Most people think", "You need"]);
  });

  it("breaks lines at maxCharsPerLine and maxWordsPerLine", () => {
    const [p] = segmentCaptions(words.slice(0, 7), layout);
    // "Here is the thing" (17) + " about" = 23 fits; + " morning" = 31 > 24 → break after "about"
    expect(p.lineBreaksAfter).toEqual([4]);
    const tight = segmentCaptions(words.slice(0, 7), { ...layout, maxWordsPerLine: 3 });
    expect(tight[0].lineBreaksAfter).toEqual([2]);
    expect(tight.length).toBeGreaterThan(1); // 7 words / 3 per line > 2 lines → second phrase
  });

  it("respects maxLines by starting a new phrase", () => {
    const phrases = segmentCaptions(words.slice(0, 7), { ...layout, maxCharsPerLine: 10, maxLines: 2 });
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    for (const p of phrases) expect(p.lineBreaksAfter.length).toBeLessThanOrEqual(1);
  });

  it("long word gets its own line", () => {
    const long = "supercalifragilisticexpialidociousness-extended";
    const phrases = segmentCaptions([w("a", 0, 100, 0), w(long, 100, 900, 1), w("b", 900, 1000, 2)], layout);
    const all = phrases.flatMap((p) => p.words.map((x) => x.text));
    expect(all).toEqual(["a", long, "b"]);
    const host = phrases.find((p) => p.words.some((x) => x.text === long))!;
    const idx = host.words.findIndex((x) => x.text === long);
    if (idx > 0) expect(host.lineBreaksAfter).toContain(idx - 1);
  });
});
