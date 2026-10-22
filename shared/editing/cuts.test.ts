import { applyCuts, detectCuts, keptSegments, mapTime, toSourceTime } from "./cuts";
import type { Cut, Phrase } from "../types";

const w = (id: string, text: string, startMs: number, endMs: number) => ({ id, text, startMs, endMs });
const cut = (startMs: number, endMs: number, shouldTrim: boolean, reason: Cut["reason"] = "pause"): Cut =>
  ({ id: `c-${startMs}`, startMs, endMs, reason, text: "", shouldTrim });
const phrase = (id: string, words: Phrase["words"], lineBreaksAfter: number[] = []): Phrase =>
  ({ id, startMs: words[0].startMs, endMs: words.at(-1)!.endMs, words, lineBreaksAfter });

describe("detectCuts", () => {
  it("detects pauses longer than 600 ms, padded 150 ms", () => {
    expect(detectCuts([w("a", "Hi", 0, 500), w("b", "there", 1500, 2000)], 2000))
      .toEqual([{ id: "cut-0", startMs: 650, endMs: 1350, reason: "pause", text: "", shouldTrim: true }]);
  });

  it("ignores gaps of 600 ms or less", () => {
    expect(detectCuts([w("a", "Hi", 0, 500), w("b", "there", 1100, 1500)], 1500)).toEqual([]);
  });

  it("detects filler words", () => {
    expect(detectCuts([w("a", "So", 0, 300), w("b", "Um,", 300, 600), w("c", "yes", 600, 900)], 900))
      .toEqual([{ id: "cut-0", startMs: 300, endMs: 600, reason: "filler", text: "Um,", shouldTrim: true }]);
  });

  it("cuts leading and trailing silence", () => {
    expect(detectCuts([w("a", "Hi", 1000, 2000)], 5000).map((c) => [c.startMs, c.endMs])).toEqual([[0, 850], [2150, 5000]]);
  });

  it("numbers cuts in time order", () => {
    const cuts = detectCuts([w("a", "Hi", 1000, 1200), w("b", "uh", 1200, 1400), w("c", "yes", 2500, 2700)], 2700);
    expect(cuts.map((c) => [c.id, c.reason, c.startMs, c.endMs])).toEqual([
      ["cut-0", "pause", 0, 850], ["cut-1", "filler", 1200, 1400], ["cut-2", "pause", 1550, 2350],
    ]);
  });

  it("no words or only fillers, no cuts", () => {
    expect(detectCuts([], 10_000)).toEqual([]);
    expect(detectCuts([w("a", "Um", 1000, 1500)], 3000)).toEqual([]); // leading + filler + trailing would remove everything
  });
});

describe("cut timeline", () => {
  it("keptSegments complements enabled cuts only", () => {
    const cuts = [cut(1000, 1500, true), cut(2000, 2500, false)];
    expect(keptSegments(3000, cuts)).toEqual([{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 3000 }]);
  });

  it("keptSegments merges overlapping cuts and drops empty segments", () => {
    expect(keptSegments(3000, [cut(0, 1000, true), cut(800, 1500, true), cut(2500, 3000, true)])).toEqual([{ startMs: 1500, endMs: 2500 }]);
  });

  it("mapTime shifts by removed time", () => {
    const cuts = [cut(1000, 1500, true)];
    expect([500, 1200, 2000].map((t) => mapTime(t, cuts))).toEqual([500, 1000, 1500]);
  });

  const input = [
    phrase("p0", [w("a", "So", 0, 300), w("b", "Um", 300, 600), w("c", "yes", 600, 900)], [1]),
    phrase("p1", [w("d", "Um", 1000, 1300)]),
    phrase("p2", [w("e", "fine", 1500, 1800)]),
  ];
  const fillers = [cut(300, 600, true, "filler"), cut(1000, 1300, true, "filler")];

  it("applyCuts drops cut words, shifts the rest, drops empty phrases", () => {
    const out = applyCuts(input, fillers);
    expect(out.map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(out[0]).toMatchObject({ startMs: 0, endMs: 600, lineBreaksAfter: [0] });
    expect(out[0].words.map((x) => [x.text, x.startMs, x.endMs])).toEqual([["So", 0, 300], ["yes", 300, 600]]);
    expect(out[1].words[0]).toMatchObject({ startMs: 900, endMs: 1200 });
  });

  it("applyCuts keeps every word when dropCutWords is false", () => {
    const out = applyCuts(input, fillers, false);
    expect(out.map((p) => p.words.length)).toEqual([3, 1]);
    expect(out[0].words[1]).toMatchObject({ startMs: 300, endMs: 300 });
    expect(out[0].lineBreaksAfter).toEqual([1]);
  });

  it("applyCuts drops a phrase whose whole span is cut, so no zero-length cue", () => {
    expect(applyCuts(input, fillers, false).map((p) => [p.id, p.startMs, p.endMs])).toEqual([["p0", 0, 600], ["p2", 900, 1200]]);
  });
});

describe("toSourceTime", () => {
  it("toSourceTime inverts mapTime", () => {
    const cuts = [cut(1000, 2000, true), cut(5000, 5500, true), cut(8000, 9000, false)];
    expect(toSourceTime(1500, cuts)).toBe(2500);
    expect(toSourceTime(4000, cuts)).toBe(5500);
    expect(toSourceTime(1000, cuts)).toBe(2000); // a cut boundary maps to the cut's end
    expect(toSourceTime(500, cuts)).toBe(500);
    for (const ms of [0, 2500, 6000, 9500]) expect(toSourceTime(mapTime(ms, cuts), cuts)).toBe(ms);
  });
});
