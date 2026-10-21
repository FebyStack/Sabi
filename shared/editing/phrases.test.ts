import type { Phrase } from "../types";
import { scalePhrase, setEmphasis } from "./phrases";

const phrase: Phrase = {
  id: "p", startMs: 1000, endMs: 3000, lineBreaksAfter: [0], emoji: "🔥",
  words: [{ id: "a", text: "one", startMs: 1000, endMs: 2000 }, { id: "b", text: "two", startMs: 2000, endMs: 3000, emphasis: "noun" }],
};

describe("phrases", () => {
  it("scalePhrase maps words linearly", () => {
    const out = scalePhrase(phrase, 2000, 6000);
    expect(out).toMatchObject({ id: "p", startMs: 2000, endMs: 6000, lineBreaksAfter: [0], emoji: "🔥" });
    expect(out.words.map((w) => [w.id, w.startMs, w.endMs])).toEqual([["a", 2000, 4000], ["b", 4000, 6000]]);
    expect(out.words[1].emphasis).toBe("noun");
    expect(scalePhrase(phrase, 1000, 1333).words.map((w) => w.endMs)).toEqual([1167, 1333]); // rounded
  });

  it("setEmphasis sets and clears", () => {
    const set = setEmphasis(phrase, "a", "keyword");
    expect(set.words[0].emphasis).toBe("keyword");
    expect(set.words[1]).toBe(phrase.words[1]);
    const cleared = setEmphasis(phrase, "b", null);
    expect("emphasis" in cleared.words[1]).toBe(false);
  });
});
