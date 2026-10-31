import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { FfmpegMedia, parseProbe } from "./media";
import { PNG_1x1_BASE64 } from "./renderer";

const hasFfprobe = (() => { try { execFileSync("ffprobe", ["-version"]); return true; } catch { return false; } })();

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

describe.skipIf(!hasFfprobe)("FfmpegMedia.probe", () => {
  it("probe accepts a png", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "probe-")), "one.png");
    writeFileSync(file, Buffer.from(PNG_1x1_BASE64, "base64"));
    expect(await new FfmpegMedia().probe(file, "image")).toEqual({ durationMs: 0, width: 1, height: 1 });
  });

  it("a png is refused by the audio/video whitelist", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "probe-")), "clip.mp4");
    writeFileSync(file, Buffer.from(PNG_1x1_BASE64, "base64"));
    await expect(new FfmpegMedia().probe(file, "av")).rejects.toThrow();
  });
});

// Spec row 2: what a phone puts in a file (GPS, a location, the camera) never reaches storage; the picture still shows upright.
describe.skipIf(!hasFfprobe)("FfmpegMedia.sanitize", () => {
  const tags = (file: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags:stream_tags:stream_side_data=rotation", "-of", "json", file], { encoding: "utf8" }));
  const topBoxes = (file: string) => { // an MP4/MOV's top-level boxes, in file order
    const b = readFileSync(file);
    const types: string[] = [];
    for (let i = 0; i + 8 <= b.length;) {
      const size = b.readUInt32BE(i) === 1 ? Number(b.readBigUInt64BE(i + 8)) : b.readUInt32BE(i) || b.length - i;
      types.push(b.toString("latin1", i + 4, i + 8));
      i += size;
    }
    return types;
  };
  const clip = (out: string) => execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-f", "lavfi", "-i", "sine", "-t", "1", "-c:v", "libx264", "-c:a", "aac", out]);

  it("an MP4 or MOV comes out with its index ahead of the media (faststart), so playback starts before the whole file arrives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-"));
    for (const ext of ["mp4", "mov"]) {
      const raw = join(dir, `raw.${ext}`), clean = join(dir, `clean.${ext}`);
      clip(raw);
      expect(topBoxes(raw).indexOf("moov"), ext).toBeGreaterThan(topBoxes(raw).indexOf("mdat")); // ffmpeg writes the index last
      await new FfmpegMedia().sanitize(raw, clean, "av");
      const boxes = topBoxes(clean);
      expect(boxes.indexOf("moov"), ext).toBeGreaterThan(-1);
      expect(boxes.indexOf("moov"), ext).toBeLessThan(boxes.indexOf("mdat"));
    }
  });

  it("mp3 and wav keep their format", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-"));
    for (const [ext, codec] of [["mp3", "mp3"], ["wav", "pcm_s16le"]]) {
      const raw = join(dir, `raw.${ext}`), clean = join(dir, `clean.${ext}`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine", "-t", "1", "-metadata", "artist=SABI-ARTIST", raw]);
      await new FfmpegMedia().sanitize(raw, clean, "av");
      const s = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "json", clean], { encoding: "utf8" }));
      expect(s.streams.map((x: { codec_name: string }) => x.codec_name), ext).toEqual([codec]);
      expect(readFileSync(clean).includes("SABI-ARTIST"), ext).toBe(false);
      expect((await new FfmpegMedia().probe(clean, "av")).durationMs, ext).toBeGreaterThan(900);
    }
  });

  it("a GPS-tagged rotated JPEG is stored upright without EXIF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-"));
    const raw = join(dir, "raw.jpg"), clean = join(dir, "clean.jpg");
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#ff0000" } })
      .withExif({ IFD0: { Make: "Apple", Model: "iPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "14/1 35/1 5800/100", GPSMapDatum: "SABI-GPS-MARK" } })
      .withMetadata({ orientation: 6 }).jpeg().toFile(raw);
    expect(readFileSync(raw).includes("SABI-GPS-MARK")).toBe(true); // the fixture really carries GPS
    await new FfmpegMedia().sanitize(raw, clean, "image");
    const m = await sharp(clean).metadata();
    expect([m.format, m.width, m.height, m.orientation, m.exif]).toEqual(["jpeg", 20, 40, undefined, undefined]); // turned upright, no EXIF left
    expect(readFileSync(clean).includes("SABI-GPS-MARK")).toBe(false);
    expect(readFileSync(clean).includes("iPhone")).toBe(false);
    expect(await new FfmpegMedia().probe(clean, "image")).toEqual({ durationMs: 0, width: 20, height: 40 });
  });

  it("png and webp keep their format", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-"));
    for (const ext of ["png", "webp"] as const) {
      const raw = join(dir, `raw.${ext}`), clean = join(dir, `clean.${ext}`);
      await sharp({ create: { width: 8, height: 4, channels: 3, background: "#00ff00" } }).withExif({ IFD0: { Model: "SABI-CAMERA" } })[ext]().toFile(raw);
      await new FfmpegMedia().sanitize(raw, clean, "image");
      const m = await sharp(clean).metadata();
      expect([m.format, m.width, m.exif], ext).toEqual([ext, 8, undefined]);
      expect(readFileSync(clean).includes("SABI-CAMERA"), ext).toBe(false);
    }
  });

  it("a located rotated MOV keeps its rotation and loses its location", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-"));
    const plain = join(dir, "plain.mov"), raw = join(dir, "raw.mov"), clean = join(dir, "clean.mov");
    clip(plain);
    const located = ["-c", "copy", "-metadata", "location=+14.5995+120.9842/", "-metadata", "com.apple.quicktime.location.ISO6709=+14.5995+120.9842+010.000/", "-movflags", "use_metadata_tags", raw];
    try {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-display_rotation", "90", "-i", plain, ...located], { stdio: "pipe" });
    } catch (err) { // ffmpeg before 6.1 (Debian 12's 5.1, the api image) has no -display_rotation: the legacy tag does it there
      if (!String((err as { stderr?: Buffer }).stderr).includes("display_rotation")) throw err;
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", plain, "-metadata:s:v:0", "rotate=90", ...located]);
    }
    expect(readFileSync(raw).includes("+14.5995")).toBe(true);
    await new FfmpegMedia().sanitize(raw, clean, "av");
    expect(readFileSync(clean).includes("+14.5995")).toBe(false);
    const t = tags(clean);
    expect(JSON.stringify(t.format?.tags ?? {})).not.toContain("location");
    expect(t.streams[0].side_data_list?.[0]?.rotation).toBe(90); // still displayed portrait
    expect(await new FfmpegMedia().probe(clean, "av")).toMatchObject({ width: 180, height: 320 });
  });
});
