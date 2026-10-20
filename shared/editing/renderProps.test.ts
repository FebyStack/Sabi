import { captionVideoProps, enabledCuts, subtitleTracks } from "./renderProps";
import type { Cut, Phrase, Project } from "../types";

const w = (id: string, text: string, startMs: number, endMs: number) => ({ id, text, startMs, endMs });
const ph = (id: string, words: Phrase["words"]): Phrase => ({ id, startMs: words[0].startMs, endMs: words.at(-1)!.endMs, words, lineBreaksAfter: [] });
const cut = (startMs: number, endMs: number, shouldTrim: boolean, reason: Cut["reason"] = "pause"): Cut =>
  ({ id: `cut-${startMs}`, startMs, endMs, reason, text: "", shouldTrim });

const phrases = [ph("p0", [w("a", "Hello", 200, 800), w("b", "um", 1200, 1500)]), ph("p1", [w("c", "world", 5000, 5500)])];
const es = [ph("p0", [w("a", "Hola", 200, 800), w("b", "amigos", 1200, 1500)]), ph("p1", [w("c", "mundo", 5000, 5500)])];
const project = (patch: Partial<Project> = {}): Project => ({
  id: "p", title: "t", aspectRatio: "9:16", mediaSource: "generate", status: "ready", sourceAssetId: "a", sourceKind: "video", language: "en",
  captionTemplateId: "clean", transcript: null, phrases, outputs: {}, warnings: [], sourceDurationMs: 21000,
  editPlan: null, translations: [{ language: "es", phrases: es }], burnInLanguage: null, overlays: [], creditsUsedCents: 0, brand: null, motionGraphics: [], createdAt: "", updatedAt: "", ...patch,
});
const opts = { videoSrc: "http://x/v.mp4", sourceDurationMs: 21000 };
const plan = (cuts: Cut[]) => ({ editPlan: { cuts, shots: [] } });

describe("captionVideoProps", () => {
  it("without enabled cuts plays the whole source", () => {
    const props = captionVideoProps(project(plan([cut(1000, 3000, false)])), opts);
    expect(props.segments).toBeUndefined();
    expect(props.durationMs).toBe(21000);
    expect(props.phrases).toEqual(phrases);
    expect(props).toMatchObject({ videoSrc: "http://x/v.mp4", sourceKind: "video", width: 1080, height: 1920 });
  });

  it("enabled cuts shorten the timeline and shift captions", () => {
    const p = project(plan([cut(1000, 3000, true)]));
    expect(enabledCuts(p)).toHaveLength(1);
    const props = captionVideoProps(p, opts);
    expect(props.durationMs).toBe(19000);
    expect(props.segments).toEqual([{ startMs: 0, endMs: 1000 }, { startMs: 3000, endMs: 21000 }]);
    expect(props.phrases[1].words[0]).toMatchObject({ text: "world", startMs: 3000, endMs: 3500 });
  });

  it("burn-in language swaps in the translated track", () => {
    const props = captionVideoProps(project({ burnInLanguage: "es" }), opts);
    expect(props.phrases.flatMap((p) => p.words.map((x) => x.text))).toEqual(["Hola", "amigos", "mundo"]);
  });
});

describe("subtitleTracks", () => {
  it("subtitles follow enabled cuts", () => {
    const tracks = subtitleTracks(project(plan([cut(1200, 1500, true, "filler"), cut(2000, 4000, true)])));
    expect(tracks.map((t) => t.language)).toEqual([null, "es"]);
    expect(tracks[0].phrases.flatMap((p) => p.words.map((x) => x.text))).toEqual(["Hello", "world"]);
    expect(tracks[1].phrases.flatMap((p) => p.words.map((x) => x.text))).toEqual(["Hola", "amigos", "mundo"]);
    for (const t of tracks) expect(t.phrases[1].words[0]).toMatchObject({ startMs: 2700, endMs: 3200 });
  });
});
