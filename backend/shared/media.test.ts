import { parseProbe } from "./media";

describe("parseProbe", () => {
  it("reads duration and coded dimensions", () => {
    expect(parseProbe({ format: { duration: "21.166" }, streams: [{ codec_type: "audio" }, { codec_type: "video", width: 540, height: 960 }] }))
      .toEqual({ durationMs: 21166, width: 540, height: 960 });
  });

  it("swaps dimensions for ±90° rotated phone clips (side data)", () => {
    expect(parseProbe({ format: { duration: "5" }, streams: [{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] }))
      .toEqual({ durationMs: 5000, width: 1080, height: 1920 });
  });

  it("swaps dimensions for the legacy rotate tag", () => {
    expect(parseProbe({ format: { duration: "5" }, streams: [{ codec_type: "video", width: 1920, height: 1080, tags: { rotate: "90" } }] }))
      .toEqual({ durationMs: 5000, width: 1080, height: 1920 });
  });

  it("keeps dimensions for 180°", () => {
    expect(parseProbe({ format: { duration: "1" }, streams: [{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{ rotation: 180 }] }] }))
      .toEqual({ durationMs: 1000, width: 1920, height: 1080 });
  });
});
