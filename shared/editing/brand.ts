import type { CSSProperties } from "react";
import { getCaptionTemplate } from "../captions/templates";
import type { BrandKit, CaptionTemplate, Project } from "../types";

// What the composition draws with: the brand kit, or the caption template's own colours when there is none.
export type BrandLook = { primary: string; accent: string; text: string; background: string; fontFamily: string; logoUrl: string | null; grade: number };

export const templateLook = (t: CaptionTemplate): BrandLook => ({
  primary: t.colors.emphasis.keyword, accent: t.colors.activeWord, text: t.colors.text, background: "#000000", fontFamily: t.font.family, logoUrl: null, grade: 0,
});

export function brandLook(project: Project, assetUrl: (id: string) => string): BrandLook {
  const b = project.brand;
  if (!b) {
    const look = templateLook(getCaptionTemplate(project.captionTemplateId));
    return project.captionStyle?.fontFamily ? { ...look, fontFamily: project.captionStyle.fontFamily } : look;
  }
  return { ...b.palette, fontFamily: b.fontFamily, logoUrl: b.logoAssetId ? assetUrl(b.logoAssetId) : null, grade: b.grade };
}

// Captions under a kit: text → text, accent → active word + keyword, primary → noun + pictorial; box and weight stay the template's.
export function brandedTemplate(t: CaptionTemplate, brand: BrandKit | null): CaptionTemplate {
  if (!brand) return t;
  const { primary, accent, text } = brand.palette;
  return {
    ...t,
    font: { ...t.font, family: brand.fontFamily },
    colors: { ...t.colors, text, activeWord: accent, emphasis: { keyword: accent, noun: primary, pictorial: primary } },
  };
}

// What the captions are drawn with: preset → brand kit → the project's caption style (absent keys keep the layer below).
export function effectiveTemplate(project: Project): CaptionTemplate {
  const t = brandedTemplate(getCaptionTemplate(project.captionTemplateId), project.brand);
  const s = project.captionStyle;
  if (!s) return t;
  const { background: box, ...colors } = t.colors;
  const background = s.background === false ? undefined : s.background ? box ?? "rgba(0,0,0,.55)" : box;
  return {
    ...t,
    font: { family: s.fontFamily ?? t.font.family, weight: s.weight ?? t.font.weight, sizePx: s.sizePx ?? t.font.sizePx },
    position: { y: s.y ?? t.position.y },
    uppercase: s.uppercase ?? t.uppercase,
    animation: s.animation ?? t.animation,
    colors: background ? { ...colors, background } : colors,
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// The grade: muted, slightly punchier footage under a soft-light wash of the primary colour. Never on MGs or captions.
export function gradeStyles(look: BrandLook): { footage: CSSProperties; tint: CSSProperties | null } {
  const g = look.grade;
  if (!g) return { footage: {}, tint: null };
  return {
    footage: { filter: `saturate(${r3(1 - 0.3 * g)}) contrast(${r3(1 + 0.1 * g)})` },
    tint: { backgroundColor: look.primary, mixBlendMode: "soft-light", opacity: r3(0.6 * g) },
  };
}
