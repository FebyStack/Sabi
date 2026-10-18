import type { CaptionTemplate } from "../types";

const layout = { maxCharsPerLine: 24, maxWordsPerLine: 5, maxLines: 2, pauseSplitMs: 700 };

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  { id: "clean", name: "Clean", font: { family: "Inter", weight: 700, sizePx: 64 }, colors: { text: "#FFFFFF", activeWord: "#FFD60A", emphasis: { keyword: "#FF9F0A", noun: "#64D2FF", pictorial: "#30D158" } },
    position: { y: 0.78 }, layout, animation: "karaoke", uppercase: false },
  { id: "bold", name: "Bold", font: { family: "Inter", weight: 900, sizePx: 80 }, colors: { text: "#FFFFFF", activeWord: "#00E676", emphasis: { keyword: "#FFD60A", noun: "#64D2FF", pictorial: "#FF6B9A" } },
    position: { y: 0.78 }, layout: { ...layout, maxCharsPerLine: 18, maxWordsPerLine: 4 }, animation: "karaoke", uppercase: true },
  { id: "karaoke", name: "Karaoke", font: { family: "Inter", weight: 800, sizePx: 68 }, colors: { text: "#FFFFFF", activeWord: "#FF3D71", background: "rgba(0,0,0,.55)", emphasis: { keyword: "#FFD60A", noun: "#64D2FF", pictorial: "#30D158" } },
    position: { y: 0.8 }, layout, animation: "karaoke", uppercase: false },
];

export function getCaptionTemplate(id: string): CaptionTemplate {
  const t = CAPTION_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown_caption_template:${id}`);
  return t;
}
