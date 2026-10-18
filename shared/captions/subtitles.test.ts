import { toSrt, toVtt } from "./subtitles";
import type { Phrase } from "../types";

const phrases: Phrase[] = [
  { id: "ph-0", startMs: 40, endMs: 4220, lineBreaksAfter: [3],
    words: ["Here", "is", "the", "thing", "about", "morning", "routines."].map((text, i) => ({ id: `w-${i}`, text, startMs: 0, endMs: 0 })) },
  { id: "ph-1", startMs: 4259, endMs: 7419, lineBreaksAfter: [],
    words: ["Most", "people", "think"].map((text, i) => ({ id: `w-${10 + i}`, text, startMs: 0, endMs: 0 })) },
];

describe("subtitle writers", () => {
  it("writes SRT with comma millis and line breaks", () => {
    expect(toSrt(phrases)).toBe(
      "1\n00:00:00,040 --> 00:00:04,220\nHere is the thing\nabout morning routines.\n\n2\n00:00:04,259 --> 00:00:07,419\nMost people think\n",
    );
  });

  it("writes VTT with header and dot millis", () => {
    expect(toVtt(phrases)).toBe(
      "WEBVTT\n\n1\n00:00:00.040 --> 00:00:04.220\nHere is the thing\nabout morning routines.\n\n2\n00:00:04.259 --> 00:00:07.419\nMost people think\n",
    );
  });

  it("handles empty input", () => {
    expect(toSrt([])).toBe("");
    expect(toVtt([])).toBe("WEBVTT\n");
  });

  it("formats hours", () => {
    const late: Phrase[] = [{ ...phrases[1], startMs: 3_600_000 + 61_001, endMs: 3_600_000 + 62_500 }];
    expect(toSrt(late)).toContain("01:01:01,001 --> 01:01:02,500");
  });
});
