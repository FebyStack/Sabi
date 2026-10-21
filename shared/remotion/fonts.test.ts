import { BRAND_FONTS } from "../contract";
import { fontCssFamily, fontStack } from "./fonts";

describe("bundled fonts", () => {
  it("maps every brand font to a loaded css family", () => {
    expect(BRAND_FONTS.map(fontCssFamily)).toEqual([
      "Inter Variable", "Montserrat Variable", "Poppins", "Bebas Neue", "Playfair Display Variable", "Space Grotesk Variable",
    ]);
    expect(fontCssFamily("Georgia")).toBe("Georgia"); // not a brand font: unchanged
  });

  it("fontStack quotes the family and falls back", () => {
    expect(fontStack("Bebas Neue")).toBe('"Bebas Neue", system-ui, sans-serif');
    expect(fontStack("Inter")).toBe('"Inter Variable", system-ui, sans-serif');
  });
});
