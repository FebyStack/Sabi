import { segmentCaptions } from "../../../shared/captions/segment";
import { getCaptionTemplate } from "../../../shared/captions/templates";
import type { Beat } from "../../../shared/types";
import sample from "../../shared/fixtures/transcript-sample.json";
import { FakeLlm } from "../../shared/llm";
import { fakeLlmResponder } from "../../shared/testing";
import { labelBeats } from "./labeler";

const phrases = segmentCaptions(sample.words, getCaptionTemplate("clean").layout);
const beat = (n: number, startMs: number, endMs: number): Beat => ({ id: `beat-${n}`, shotId: `shot-${n}`, startMs, endMs, placement: "full", media: "image" });
const beats = [beat(0, 4300, 9300), beat(1, 15300, 20300)];
const label = (i: number, wantsVideo = false, query = `q${i}`) => ({ i, query, prompt: `p${i}`, intent: `intent ${i}`, wantsVideo });

describe("labelBeats", () => {
  it("labels beats from llm and fills gaps", async () => {
    const llm = new FakeLlm(() => ({ labels: [label(1)] }));
    const out = await labelBeats(llm, beats, phrases, { allowVideo: false });
    expect(JSON.parse(llm.calls[0].user).beats[0]).toEqual({ i: 0, text: expect.stringMatching(/^two hours of meditation/) });
    expect(out[1]).toMatchObject({ id: "beat-1", query: "q1", prompt: "p1", intent: "intent 1", media: "image" });
    expect(out[0]).toMatchObject({ id: "beat-0", query: "two hours of meditation, a cold", intent: "two hours of meditation, a cold", prompt: "photo of two hours of meditation, a cold" });
  });

  it("only the first wantsVideo beat becomes video when allowed", async () => {
    const three = [...beats, beat(2, 21000, 24000)];
    const llm = new FakeLlm(() => ({ labels: [label(0), label(1, true), label(2, true)] }));
    expect((await labelBeats(llm, three, phrases, { allowVideo: true })).map((b) => b.media)).toEqual(["image", "video", "image"]);
  });

  it("never video when not allowed", async () => {
    const llm = new FakeLlm(() => ({ labels: [label(0, true), label(1, true)] }));
    expect((await labelBeats(llm, beats, phrases, { allowVideo: false })).map((b) => b.media)).toEqual(["image", "image"]);
  });

  it("normalizes bad llm output", async () => {
    const long = `"sunrise"\nover\r\nthe ${"sea ".repeat(80)}`;
    const llm = new FakeLlm(() => ({ labels: [label(7, true), label(-1), label(0.5), label(0, false, long), label(0, false, "second wins?")] }));
    const out = await labelBeats(llm, beats, phrases, { allowVideo: true });
    expect(out[0].query).toBe(`sunrise over the ${"sea ".repeat(80)}`.slice(0, 60).trim());
    expect(out[0].query).not.toMatch(/["\n\r]/);
    expect(out[1].query).toMatch(/^You need one small habit/); // only out-of-range labels: falls back to its text
    expect(out.map((b) => b.media)).toEqual(["image", "image"]);
  });

  it("fake responder labels beats deterministically", async () => {
    const out = await labelBeats(new FakeLlm(fakeLlmResponder), beats, phrases, { allowVideo: true });
    expect(out.map((b) => [b.query, b.media])).toEqual([["stock two", "image"], ["stock You", "video"]]);
  });
});
