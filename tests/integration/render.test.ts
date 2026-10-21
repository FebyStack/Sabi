import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemotionRenderer } from "../../backend/shared/renderer";
import { getCaptionTemplate } from "../../shared/captions/templates";
import { templateLook } from "../../shared/editing/brand";
import type { CaptionVideoProps } from "../../shared/remotion/CaptionVideo";
import type { Phrase } from "../../shared/types";

const words = [
  { id: "w-0", text: "Hello", startMs: 100, endMs: 700 },
  { id: "w-1", text: "captions", startMs: 700, endMs: 1300 },
  { id: "w-2", text: "world", startMs: 1300, endMs: 1900 },
];

// RGB of one pixel of the frame at `atS` seconds.
const pixel = (file: string, atS: number, x: number, y: number) =>
  [...execFileSync("ffmpeg", ["-v", "error", "-ss", String(atS), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])].slice(0, 3);
const phrases: Phrase[] = [{ id: "ph-0", startMs: 100, endMs: 1900, lineBreaksAfter: [1], words }];

// Real Chromium render; opt in with RUN_RENDER=1 (npm run render:sample).
describe.skipIf(process.env.RUN_RENDER !== "1")("RemotionRenderer", () => {
  let dir: string, videoSrc: string, base: string, server: Server, renderer: RemotionRenderer;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "render-"));
    renderer = new RemotionRenderer({ entry: "shared/remotion/index.ts", bundleDir: join(dir, "bundle") }); // one bundle for both cases
    const clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=2:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    // Chromium needs an http(s) URL for the source video, same as the API serves in production.
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=400x600", "-frames:v", "1", join(dir, "red.png")]);
    server = createServer((req, res) => {
      const png = req.url === "/red.png";
      res.writeHead(200, { "content-type": png ? "image/png" : "video/mp4" });
      createReadStream(png ? join(dir, "red.png") : clip).pipe(res);
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    videoSrc = `${base}/clip.mp4`;
  });
  afterAll(() => server.close());

  const render = async (props: Partial<CaptionVideoProps> & { phrases: Phrase[]; durationMs: number }, name: string, scale: 1 | 2 = 1) => {
    const outPath = join(dir, name);
    await renderer.render({
      scale,
      compositionId: "CaptionVideo",
      inputProps: {
        videoSrc, sourceKind: "video", template: getCaptionTemplate("clean"), width: 1080, height: 1920,
        brand: templateLook(getCaptionTemplate("clean")), overlays: [], motionGraphics: [], ...props,
      },
      durationMs: props.durationMs,
      outPath,
    });
    return outPath;
  };

  it("renders captions over a generated clip", async () => {
    const phrases: Phrase[] = [{ id: "ph-0", startMs: 100, endMs: 1900, lineBreaksAfter: [1], words }];
    expect(statSync(await render({ phrases, durationMs: 2000 }, "out.mp4")).size).toBeGreaterThan(10_000);
  }, 900_000); // webpack bundle + Chromium render on the ExFAT SSD is slow the first time

  it("renders cut segments with an emphasised word and an emoji", async () => {
    // [800, 1200] cut: "captions" now runs 700–800 in output time, "world" 900–1500.
    const phrases: Phrase[] = [{
      id: "ph-0", startMs: 100, endMs: 1500, lineBreaksAfter: [], emoji: "🔥",
      words: [words[0], { ...words[1], endMs: 800, emphasis: "keyword" }, { ...words[2], startMs: 900, endMs: 1500 }],
    }];
    const out = await render({ phrases, durationMs: 1600, segments: [{ startMs: 0, endMs: 800 }, { startMs: 1200, endMs: 2000 }] }, "cut.mp4");
    expect(statSync(out).size).toBeGreaterThan(10_000);
    const probed = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString();
    expect(Number(probed)).toBeCloseTo(1.6, 1);
  }, 900_000);

  it("renders at scale 2", async () => {
    const out = await render({ phrases, durationMs: 1000 }, "4k.mp4", 2);
    const width = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", out]).toString().trim();
    expect(width).toBe("2160");
  }, 300_000);

  it("renders a real still", async () => {
    const phrases: Phrase[] = [{ id: "ph-0", startMs: 100, endMs: 1900, lineBreaksAfter: [1], words }];
    const inputProps: CaptionVideoProps = { videoSrc, sourceKind: "video", template: getCaptionTemplate("clean"), width: 1080, height: 1920, phrases, durationMs: 2000 };
    const still = async (width: number, timestampMs: number) => {
      const outPath = join(dir, `still-${width}.png`);
      await renderer.renderStill({ compositionId: "CaptionVideo", inputProps, timestampMs, width, outPath });
      return readFileSync(outPath);
    };
    expect((await still(540, 1000)).length).toBeGreaterThan(5_000);
    expect((await still(270, 2000)).readUInt32BE(16)).toBe(270); // IHDR width; t = durationMs is clamped to the last frame
  }, 900_000);

  it("renders a top overlay image under the captions", async () => {
    const out = await render({ phrases, durationMs: 2000, overlays: [{ id: "ov-0", src: `${base}/red.png`, media: "image", startMs: 0, endMs: 2000, placement: "top", transition: "fade" }] }, "overlay.mp4");
    expect(statSync(out).size).toBeGreaterThan(10_000);
    const [r, g] = pixel(out, 1, 540, 600); // inside the top band (6 %–55 %)
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(80);
    expect(pixel(out, 1, 540, 1250)[0]).toBeLessThan(60); // below the band: the black clip
  }, 900_000);

  it("renders a brand-graded clip with a motion graphic", async () => {
    const brand = { primary: "#1E90FF", accent: "#FFD60A", text: "#FFFFFF", background: "#0B0B0B", fontFamily: "Inter", logoUrl: null, grade: 0.6 };
    const compiled = `const Component = ({ item }) => React.createElement("div", { style: { position: "absolute", inset: 0, background: item.brand.accent } });`;
    const out = await render({ phrases, durationMs: 2000, brand, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 2000, box: { x: 0, y: 0, w: 1, h: 0.2 }, props: {} }] }, "brand.mp4");
    expect(statSync(out).size).toBeGreaterThan(10_000);
    const [r, g, b] = pixel(out, 1, 540, 100); // the MG is drawn above the grade, in the accent colour
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(170);
    expect(b).toBeLessThan(90);
  }, 900_000);

  it("renders a motion graphic that throws without failing", async () => {
    const compiled = "const Component = () => { throw new Error('boom'); };";
    const out = await render({ phrases, durationMs: 1000, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: {} }] }, "throws.mp4");
    const [r, g] = pixel(out, 0.5, 6, 6); // the red ⚠ mg-0 label at the box's top-left
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  it("an MG image that fails to load draws a marker instead of failing the render", async () => {
    const compiled = `const Component = () => React.createElement(Img, { src: "${base}/missing.png", style: { position: "absolute", inset: 0, width: "100%", height: "100%" } });`;
    const out = await render({ phrases, durationMs: 1000, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 0.3 }, props: {} }] }, "badimg.mp4");
    const [r, g] = pixel(out, 0.5, 900, 400); // inside the red ⚠ image marker that replaced the image
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  it("an infinite loop fails the render within the timeout", async () => {
    const compiled = "const Component = () => { for (;;) {} };";
    const started = Date.now();
    await expect(render({ phrases, durationMs: 1000, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: {} }] }, "loop.mp4")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(90_000);
  }, 900_000);
});
