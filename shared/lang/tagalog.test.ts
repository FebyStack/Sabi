import { TL_FUNCTION_WORDS, TL_HESITATION, TL_NO_STRAND, isTagalog, normWord } from "./tagalog";

describe("tagalog", () => {
  it("isTagalog accepts tl and fil only", () => {
    expect(["tl", "fil"].map(isTagalog)).toEqual([true, true]);
    expect(["en", "ms", "", null, undefined].map(isTagalog)).toEqual([false, false, false, false, false]);
  });

  it("normWord strips apostrophes and punctuation", () => {
    expect(normWord("'yung")).toBe("yung");
    expect(normWord("Ano...")).toBe("ano");
  });

  it("function words include every no-strand and hesitation word", () => {
    for (const w of [...TL_NO_STRAND, ...TL_HESITATION]) expect(TL_FUNCTION_WORDS.has(w)).toBe(true);
    expect(TL_FUNCTION_WORDS.has("po")).toBe(true);
  });
});
