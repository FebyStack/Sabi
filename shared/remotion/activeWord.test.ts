import { activeWordIndex, phraseAt, segmentFrames, wordColor } from "./activeWord";
import { getCaptionTemplate } from "../captions/templates";
import type { Phrase } from "../types";

const phrase: Phrase = {
  id: "ph-0", startMs: 40, endMs: 1000, lineBreaksAfter: [],
  words: [
    { id: "w-0", text: "Here", startMs: 40, endMs: 290 },
    { id: "w-1", text: "is", startMs: 290, endMs: 400 },
    { id: "w-2", text: "the", startMs: 400, endMs: 1000 },
  ],
};
const later: Phrase = { ...phrase, id: "ph-1", startMs: 4000, endMs: 4500 };

describe("phraseAt", () => {
  it("returns the phrase containing the time", () => {
    expect(phraseAt([phrase, later], 4100)?.id).toBe("ph-1");
    expect(phraseAt([phrase, later], 150)?.id).toBe("ph-0");
  });
  it("returns null outside every phrase", () => {
    expect(phraseAt([phrase, later], 100_000)).toBeNull();
    expect(phraseAt([phrase, later], 2000)).toBeNull();
  });
});

describe("activeWordIndex", () => {
  it("is -1 before the first word, the index while speaking, the last index after the end", () => {
    expect(activeWordIndex(phrase, 5)).toBe(-1);
    expect(activeWordIndex(phrase, 150)).toBe(0);
    expect(activeWordIndex(phrase, 350)).toBe(1);
    expect(activeWordIndex(phrase, 5000)).toBe(2);
  });
});

describe("wordColor", () => {
  it("wordColor: active beats emphasis beats text", () => {
    const clean = getCaptionTemplate("clean");
    const noun = { ...phrase.words[0], emphasis: "noun" as const };
    expect(wordColor(clean, noun, true)).toBe("#FFD60A");
    expect(wordColor(clean, noun, false)).toBe("#64D2FF");
    expect(wordColor(clean, phrase.words[0], false)).toBe("#FFFFFF");
  });
});

describe("segmentFrames", () => {
  it("segmentFrames rounds on the cumulative timeline and ends on the composition's last frame", () => {
    expect(segmentFrames([{ startMs: 0, endMs: 1010 }, { startMs: 2000, endMs: 3010 }], 30))
      .toEqual([{ trimBefore: 0, durationInFrames: 30 }, { trimBefore: 60, durationInFrames: 31 }]); // 30.3 → 30; total 60.6 → ceil 61
    expect(segmentFrames([{ startMs: 0, endMs: 2010 }], 30)).toEqual([{ trimBefore: 0, durationInFrames: 61 }]); // round would give 60
  });

  it("drops segments shorter than a frame", () => {
    expect(segmentFrames([{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 1510 }, { startMs: 2000, endMs: 3000 }], 30))
      .toEqual([{ trimBefore: 0, durationInFrames: 30 }, { trimBefore: 60, durationInFrames: 31 }]);
  });
});
