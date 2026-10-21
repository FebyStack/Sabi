import { applyPhraseEdits } from "./PhraseEditor";
import { retimePhrase } from "@shared/captions/retime";
import type { Phrase } from "@shared/types";

const phrase: Phrase = {
  id: "ph-0", startMs: 0, endMs: 1000, lineBreaksAfter: [0],
  words: [{ id: "a", text: "Here", startMs: 0, endMs: 400 }, { id: "b", text: "is", startMs: 400, endMs: 1000 }],
};

describe("retimePhrase", () => {
  it("keeps timings when the word count is unchanged", () => {
    expect(retimePhrase(phrase, "HERE is").words.map((w) => [w.text, w.startMs, w.endMs])).toEqual([["HERE", 0, 400], ["is", 400, 1000]]);
  });
  it("spreads the phrase span by character length when words change", () => {
    const r = retimePhrase(phrase, "Here it is");
    expect(r.words.map((w) => w.text)).toEqual(["Here", "it", "is"]);
    expect(r.words[0].startMs).toBe(0);
    expect(r.words.at(-1)?.endMs).toBe(1000);
  });
});

describe("applyPhraseEdits", () => {
  it("drops phrases whose text was cleared", () => {
    expect(applyPhraseEdits([phrase, { ...phrase, id: "ph-1" }], ["", "still here"]).map((p) => p.id)).toEqual(["ph-1"]);
  });
});
