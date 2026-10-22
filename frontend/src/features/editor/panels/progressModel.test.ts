import { STAGES, STAGE_LABELS, stageView } from "./progressModel";

const v = (kind: string | null, stage: string | null, progress: number, extra: Partial<Parameters<typeof stageView>[0]> = {}) =>
  stageView({ uploadPct: null, kind, stage, progress, status: null, ...extra });

describe("progressModel", () => {
  it("maps every job stage onto the five stages with scaled percentages", () => {
    expect(STAGES.map((s) => STAGE_LABELS[s])).toEqual(["Uploading", "Transcribing", "Planning the edit", "Generating B-roll", "Rendering"]);
    const table: [ReturnType<typeof v>, { stage: string; pct: number }][] = [
      [v("captions", "transcribe", 40), { stage: "transcribing", pct: 67 }],
      [v("captions", "extract-audio", 10), { stage: "transcribing", pct: 17 }],
      [v("captions", "segment", 60), { stage: "transcribing", pct: 100 }],
      [v("plan", "translate", 55), { stage: "planning", pct: 79 }],
      [v("plan", "plan", 10), { stage: "planning", pct: 14 }],
      [v("broll", "fetch", 50), { stage: "generating", pct: 63 }],
      [v("broll", "beats", 5), { stage: "generating", pct: 6 }],
      [v("generate", "generate", 10), { stage: "generating", pct: 10 }],
      [v("generate", "import", 60), { stage: "generating", pct: 60 }],
      [v("generate", null, 0), { stage: "generating", pct: 0 }], // queued behind another project's job
      [v("captions", "render", 70), { stage: "rendering", pct: 25 }],
      [v("plan", "subtitles", 95), { stage: "rendering", pct: 88 }],
      [v("broll", "render", 70), { stage: "rendering", pct: 25 }],
      [v(null, null, 0, { uploadPct: 30 }), { stage: "uploading", pct: 30 }],
      [v(null, null, 0, { status: "rendering" }), { stage: "rendering", pct: 0 }],
      [v("captions", null, 0, { status: "transcribing" }), { stage: "transcribing", pct: 0 }],
      [v("captions", "render", 140), { stage: "rendering", pct: 100 }], // clamped
    ];
    for (const [got, want] of table) expect(got).toEqual(want);
  });

  it("nothing running is null", () => {
    expect(v(null, null, 0)).toBeNull();
    expect(v(null, null, 0, { status: "ready" })).toBeNull();
  });
});
