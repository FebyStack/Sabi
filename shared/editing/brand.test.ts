import { getCaptionTemplate } from "../captions/templates";
import type { BrandKit, Project } from "../types";
import { brandLook, brandedTemplate, effectiveTemplate, gradeStyles, templateLook } from "./brand";

const kit: BrandKit = { palette: { primary: "#1E90FF", accent: "#FFD60A", text: "#FAFAFA", background: "#0B0B0B" }, fontFamily: "Space Grotesk", logoAssetId: "logo", grade: 0.4 };
const proj = (brand: BrandKit | null, patch: Partial<Project> = {}) => ({ captionTemplateId: "clean", brand, captionStyle: null, ...patch }) as Project;

describe("brand look", () => {
  it("brandLook falls back to the template", () => {
    expect(brandLook(proj(null), (id) => `/a/${id}`)).toEqual({
      primary: "#FF9F0A", accent: "#FFD60A", text: "#FFFFFF", background: "#000000", fontFamily: "Inter", logoUrl: null, grade: 0,
    });
    expect(templateLook(getCaptionTemplate("clean")).grade).toBe(0);
    expect(brandLook(proj(kit), (id) => `/a/${id}`)).toEqual({ ...kit.palette, fontFamily: "Space Grotesk", logoUrl: "/a/logo", grade: 0.4 });
  });

  it("brandedTemplate recolours captions and keeps the background", () => {
    const karaoke = getCaptionTemplate("karaoke");
    const t = brandedTemplate(karaoke, kit);
    expect(t.colors).toEqual({ text: "#FAFAFA", activeWord: "#FFD60A", background: "rgba(0,0,0,.55)", emphasis: { keyword: "#FFD60A", noun: "#1E90FF", pictorial: "#1E90FF" } });
    expect(t.font).toEqual({ ...karaoke.font, family: "Space Grotesk" });
    expect(brandedTemplate(karaoke, null)).toBe(karaoke);
  });

  it("gradeStyles is empty at zero and tints at 0.4", () => {
    expect(gradeStyles({ ...templateLook(getCaptionTemplate("clean")), grade: 0 })).toEqual({ footage: {}, tint: null });
    expect(gradeStyles(brandLook(proj(kit), (id) => id))).toEqual({
      footage: { filter: "saturate(0.88) contrast(1.04)" },
      tint: { backgroundColor: "#1E90FF", mixBlendMode: "soft-light", opacity: 0.24 },
    });
  });
});

describe("effectiveTemplate", () => {
  it("effectiveTemplate layers style over brand over preset", () => {
    const t = effectiveTemplate(proj({ ...kit, fontFamily: "Montserrat" }, { captionTemplateId: "bold", captionStyle: { sizePx: 96, y: 0.6, background: true } }));
    expect(t.font).toEqual({ family: "Montserrat", weight: 900, sizePx: 96 });
    expect(t.position.y).toBe(0.6);
    expect(t.colors.background).toBe("rgba(0,0,0,.55)");
    expect(t.uppercase).toBe(true);
    expect(t.colors.text).toBe("#FAFAFA");
  });

  it("style fields override one by one and background false removes the box", () => {
    const t = effectiveTemplate(proj(null, { captionTemplateId: "karaoke", captionStyle: { fontFamily: "Bebas Neue", weight: 400, uppercase: true, animation: "none", background: false } }));
    expect(t.font).toEqual({ family: "Bebas Neue", weight: 400, sizePx: 68 });
    expect(t).toMatchObject({ uppercase: true, animation: "none" });
    expect("background" in t.colors).toBe(false);
    expect(effectiveTemplate(proj(null))).toEqual(getCaptionTemplate("clean"));
  });

  it("brandLook takes the caption style font without a brand", () => {
    expect(brandLook(proj(null, { captionStyle: { fontFamily: "Poppins" } }), (id) => id).fontFamily).toBe("Poppins");
    expect(brandLook(proj(kit, { captionStyle: { fontFamily: "Poppins" } }), (id) => id).fontFamily).toBe("Space Grotesk");
  });
});
