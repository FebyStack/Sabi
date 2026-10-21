import { CAPTION_MIN_CONTRAST, contrastRatio, relativeLuminance } from "./contrast";

describe("contrast", () => {
  it("white on black is 21:1", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5); // order does not matter
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1);
    expect(relativeLuminance("#000000")).toBe(0);
  });

  it("#777777 on #555555 is under 3:1", () => {
    expect(contrastRatio("#777777", "#555555")).toBeLessThan(CAPTION_MIN_CONTRAST);
    expect(contrastRatio("#FFD60A", "#0B0B0B")).toBeGreaterThan(CAPTION_MIN_CONTRAST);
  });
});
