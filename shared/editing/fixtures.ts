import type { Phrase, Project, Word } from "../types";

// Test fixture shared by the editing and editor tests (never imported by app code): 21 s source,
// 3 shots 0–4000 Hook / 4000–12000 B-Roll / 12000–21000 Talking Head, 3 phrases, one overlay on shot-1, one MG.
const w = (id: string, text: string, startMs: number, endMs: number, extra: Partial<Word> = {}): Word => ({ id, text, startMs, endMs, ...extra });
const ph = (id: string, words: Word[], extra: Partial<Phrase> = {}): Phrase =>
  ({ id, startMs: words[0].startMs, endMs: words.at(-1)!.endMs, words, lineBreaksAfter: [], ...extra });

export function editorProject(patch: Partial<Project> = {}): Project {
  return {
    id: "p1", title: "Morning", aspectRatio: "9:16", mediaSource: "stock", status: "ready", sourceAssetId: "src", sourceKind: "video", language: "en",
    captionTemplateId: "clean", transcript: null,
    phrases: [
      ph("ph-0", [w("w-0", "Morning", 500, 1000), w("w-1", "routines", 1000, 2000)]),
      ph("ph-1", [w("w-2", "that", 2500, 3000), w("w-3", "stick", 3000, 4500, { emphasis: "keyword" })]),
      ph("ph-2", [w("w-4", "every", 13000, 14000), w("w-5", "day", 14000, 15000)], { emoji: "☀️" }),
    ],
    outputs: { mp4AssetId: "mp4", srtAssetId: "srt", vttAssetId: "vtt" }, warnings: [], sourceDurationMs: 21000,
    editPlan: {
      cuts: [
        { id: "cut-0", startMs: 2000, endMs: 2500, reason: "pause", text: "", shouldTrim: true },
        { id: "cut-1", startMs: 8000, endMs: 8300, reason: "filler", text: "um", shouldTrim: false },
      ],
      shots: [
        { id: "shot-0", kind: "Hook", startMs: 0, endMs: 4000 },
        { id: "shot-1", kind: "B-Roll", startMs: 4000, endMs: 12000 },
        { id: "shot-2", kind: "Talking Head", startMs: 12000, endMs: 21000 },
      ],
    },
    translations: [], burnInLanguage: null,
    overlays: [{
      id: "ov-0", shotId: "shot-1", assetId: "img-0", media: "image", source: "stock", startMs: 5000, endMs: 9000, placement: "full", transition: "fade",
      enabled: true, query: "sunrise kitchen", prompt: "", intent: "morning", attribution: { author: "A", url: "https://www.pexels.com/photo/1" },
    }],
    creditsUsedCents: 0, brand: null,
    motionGraphics: [{ id: "mg-0", name: "Stat", code: "const Component = () => null;", compiled: "c", startMs: 1000, endMs: 3000, box: { x: 0, y: 0, w: 1, h: 0.5 }, props: [], enabled: true }],
    captionStyle: null, demo: false,
    createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "v1",
    ...patch,
  };
}
