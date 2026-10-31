import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemotionRenderer } from "../../backend/shared/renderer";
import { getCaptionTemplate } from "../../shared/captions/templates";
import { templateLook } from "../../shared/editing/brand";
import type { MotionGraphicProps } from "../../shared/editing/overlays";
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
// RGB of one pixel of output frame `n`.
const pixelAt = (file: string, n: number, x: number, y: number) =>
  [...execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),crop=2:2:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])].slice(0, 3);
const mgp = (compiled: string, extra: Partial<MotionGraphicProps> = {}): MotionGraphicProps =>
  ({ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: {}, images: [], ...extra });
const frameRed = 'const Component = () => React.createElement("div", { style: { position: "absolute", inset: 0, background: `rgb(${useCurrentFrame() * 4},0,0)` } });';

// Real Chromium render; opt in with RUN_RENDER=1 (npm run render:sample).
describe.skipIf(process.env.RUN_RENDER !== "1")("RemotionRenderer", () => {
  let dir: string, videoSrc: string, base: string, server: Server, renderer: RemotionRenderer, canary: Server, canaryUrl: string;
  const canaryHits: string[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "render-"));
    renderer = new RemotionRenderer({ entry: "shared/remotion/index.ts", bundleDir: join(dir, "bundle") }); // one bundle for both cases
    const clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=2:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    // Chromium needs an http(s) URL for the source video, same as the API serves in production.
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=400x600", "-frames:v", "1", join(dir, "red.png")]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=400x600", "-frames:v", "1", join(dir, "blue.png")]);
    // A loud 440 Hz tone: a hard cut through it at an arbitrary phase is an audible click.
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=3:r=30", "-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*440*t):s=48000:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "320k", "-shortest", join(dir, "tone.mp4")]);
    server = createServer((req, res) => {
      const png = req.url === "/red.png" || req.url === "/blue.png";
      // CORS: the page fetches an MG's image props itself and hands the bytes to the MG's sandbox.
      res.writeHead(200, { "content-type": png ? "image/png" : "video/mp4", "access-control-allow-origin": "*" });
      createReadStream(png ? join(dir, req.url!.slice(1)) : req.url === "/tone.mp4" ? join(dir, "tone.mp4") : clip).pipe(res);
    }).listen(0);
    // Every request an MG's sandbox manages to send lands here.
    canary = createServer((req, res) => { canaryHits.push(req.url ?? ""); res.end("x"); }).listen(0);
    canaryUrl = `http://127.0.0.1:${(canary.address() as AddressInfo).port}`;
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    videoSrc = `${base}/clip.mp4`;
  });
  afterAll(() => { server.close(); canary.close(); });

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

  it("renders with a bundled display font", async () => {
    const font = (family: string) => ({ ...getCaptionTemplate("clean"), font: { ...getCaptionTemplate("clean").font, family } });
    const one = [{ ...phrases[0], words: words.map((w) => ({ ...w, startMs: 0, endMs: 1000 })) }];
    const bebas = await render({ phrases: one, durationMs: 1000, template: font("Bebas Neue") }, "bebas.mp4");
    const inter = await render({ phrases: one, durationMs: 1000, template: font("Inter") }, "inter.mp4");
    const y = Math.round(1920 * 0.78 + 40);
    const row = (f: string) => [300, 370, 440, 510, 580, 650, 720, 790].map((x) => pixel(f, 0.5, x, y).join(","));
    expect(row(bebas)).not.toEqual(row(inter));
  }, 300_000);

  it("cuts do not click: the audio fades to silence and back at every cut", async () => {
    // 1333 − 700 ms is not a whole number of 440 Hz cycles, so the tone's phase jumps at the join.
    const out = await render({ videoSrc: `${base}/tone.mp4`, phrases: [], durationMs: 2367, segments: [{ startMs: 0, endMs: 700 }, { startMs: 1333, endMs: 3000 }] }, "cut-tone.mp4");
    const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 64 * 1024 ** 2 });
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const at = Math.round(0.7 * 48000); // the cut, in output samples
    const win = (fromMs: number, toMs: number) => Array.from(x.subarray(at + (fromMs * 48), at + (toMs * 48)));
    const jump = Math.max(...win(-10, 10).map((v, i, a) => (i ? Math.abs(v - a[i - 1]) : 0)));
    expect(jump).toBeLessThan(0.07); // a clean 0.8 × 440 Hz tone moves at most 0.046 per sample
    expect(Math.min(...win(-3, 3).map(Math.abs))).toBeLessThan(0.05); // faded to silence at the join
    expect(Math.max(...win(30, 60).map(Math.abs))).toBeGreaterThan(0.7); // full level again 30 ms later
  }, 300_000);

  it("renders at scale 2", async () => {
    const out = await render({ phrases, durationMs: 1000 }, "4k.mp4", 2);
    const width = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "default=nw=1:nk=1", out]).toString().trim();
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
    const out = await render({ phrases, durationMs: 2000, brand, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 2000, box: { x: 0, y: 0, w: 1, h: 0.2 }, props: {}, images: [] }] }, "brand.mp4");
    expect(statSync(out).size).toBeGreaterThan(10_000);
    const [r, g, b] = pixel(out, 1, 540, 100); // the MG is drawn above the grade, in the accent colour
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(170);
    expect(b).toBeLessThan(90);
  }, 900_000);

  it("renders a motion graphic that throws without failing", async () => {
    const compiled = "const Component = () => { throw new Error('boom'); };";
    const out = await render({ phrases, durationMs: 1000, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: {}, images: [] }] }, "throws.mp4");
    const [r, g] = pixel(out, 0.5, 6, 6); // the red ⚠ mg-0 label at the box's top-left
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  it("an MG image that fails to load draws a marker instead of failing the render", async () => {
    const compiled = `const Component = () => React.createElement(Img, { src: "${base}/missing.png", style: { position: "absolute", inset: 0, width: "100%", height: "100%" } });`;
    const out = await render({ phrases, durationMs: 1000, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 0.3 }, props: {}, images: [] }] }, "badimg.mp4");
    const [r, g] = pixel(out, 0.5, 900, 400); // inside the red ⚠ image marker that replaced the image
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  it("an infinite loop fails the render within the timeout", async () => {
    const compiled = "const Component = () => { for (;;) {} };";
    const started = Date.now();
    await expect(render({ phrases, durationMs: 1000, motionGraphics: [{ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: {}, images: [] }] }, "loop.mp4")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(90_000);
  }, 900_000);

  it("MG frames are exact", async () => {
    const out = await render({ phrases: [], durationMs: 2000, motionGraphics: [mgp(frameRed, { endMs: 2000 })] }, "mg-exact.mp4");
    for (const f of [0, 15, 30, 45]) expect(Math.abs(pixelAt(out, f, 540, 960)[0] - f * 4), `frame ${f}`).toBeLessThanOrEqual(6);
  }, 900_000);

  it("an MG cannot reach the network or the page", async () => {
    canaryHits.length = 0;
    const compiled = `const Component = () => {
  const c = ${JSON.stringify(canaryUrl)};
  try { fetch(c + "/fetch").catch(() => {}); } catch (e) {}
  try { const x = new XMLHttpRequest(); x.open("GET", c + "/xhr"); x.send(); } catch (e) {}
  try { new WebSocket(c.replace("http", "ws") + "/ws"); } catch (e) {}
  try { navigator.sendBeacon(c + "/beacon", "x"); } catch (e) {}
  try { new Image().src = c + "/img"; } catch (e) {}
  try { window.parent.document.body.style.background = "red"; } catch (e) {}
  return React.createElement("div", { style: { position: "absolute", inset: 0, background: "#00ff00" } },
    React.createElement("div", { style: { width: 10, height: 10, backgroundImage: "url(" + c + "/css)" } }),
    React.createElement("iframe", { src: c + "/frame", style: { width: 10, height: 10 } }));
};`;
    const out = await render({ phrases: [], durationMs: 1000, motionGraphics: [mgp(compiled, { box: { x: 0, y: 0, w: 1, h: 0.2 } })] }, "mg-nonet.mp4");
    await new Promise((r) => setTimeout(r, 1000));
    expect(canaryHits).toEqual([]);
    const [r, g] = pixelAt(out, 15, 540, 200);
    expect(g).toBeGreaterThan(200);
    expect(r).toBeLessThan(60);
    expect(pixelAt(out, 15, 540, 1500)[0]).toBeLessThan(60); // the page underneath is untouched
  }, 900_000);

  it("an MG that navigates draws ⚠ and reaches nothing", async () => {
    canaryHits.length = 0;
    const compiled = `const Component = () => { location.href = ${JSON.stringify(`${canaryUrl}/nav`)}; return null; };`;
    const out = await render({ phrases: [], durationMs: 1000, motionGraphics: [mgp(compiled, { box: { x: 0, y: 0, w: 1, h: 0.5 } })] }, "mg-nav.mp4");
    await new Promise((r) => setTimeout(r, 1000));
    expect(canaryHits).toEqual([]);
    const [r, g] = pixelAt(out, 25, 6, 6); // the page's red ⚠ mg-0 at the box's top-left
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  const imgMg = 'const Component = ({ item }) => React.createElement(Img, { src: item.props.photo, style: { position: "absolute", inset: 0, width: "100%", height: "100%" } });';

  it("an image prop is drawn from bytes", async () => {
    const photo = `${base}/blue.png`;
    const out = await render({ phrases: [], durationMs: 1000, motionGraphics: [mgp(imgMg, { props: { photo }, images: [photo], box: { x: 0, y: 0, w: 1, h: 0.3 } })] }, "mg-imgprop.mp4");
    const [r, , b] = pixelAt(out, 15, 540, 300);
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(60);
  }, 900_000);

  it("an image prop that doesn't decode draws ⚠ image", async () => {
    const photo = `${base}/missing.png`; // served as MP4 bytes
    const out = await render({ phrases: [], durationMs: 1000, motionGraphics: [mgp(imgMg, { props: { photo }, images: [photo], box: { x: 0, y: 0, w: 1, h: 0.3 } })] }, "mg-imgbad.mp4");
    const [r, g] = pixelAt(out, 15, 900, 400); // inside the red ⚠ image marker
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  it("a silent MG becomes ⚠ in 5 s and the render finishes", async () => {
    // Breaks its sandbox's runtime (which waits on Promise.allSettled before answering a frame), so no frame is answered.
    const compiled = 'const Component = () => { Promise.allSettled = () => new Promise(() => {}); return null; };';
    const started = Date.now();
    const out = await render({ phrases: [], durationMs: 1000, motionGraphics: [mgp(compiled)] }, "mg-silent.mp4");
    expect(Date.now() - started).toBeLessThan(60_000);
    const [r, g] = pixelAt(out, 27, 6, 6);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  it("two MGs on one frame of a 4K export", async () => {
    const fill = (c: string) => `const Component = () => React.createElement("div", { style: { position: "absolute", inset: 0, background: "${c}" } });`;
    const out = await render({ phrases: [], durationMs: 1000, motionGraphics: [
      mgp(fill("#00ff00"), { id: "mg-0", box: { x: 0, y: 0, w: 1, h: 0.2 } }),
      mgp(fill("#0000ff"), { id: "mg-1", box: { x: 0, y: 0.8, w: 1, h: 0.2 } }),
    ] }, "mg-two-4k.mp4", 2);
    expect(pixelAt(out, 15, 1080, 300)[1]).toBeGreaterThan(200);
    expect(pixelAt(out, 15, 1080, 3500)[2]).toBeGreaterThan(200);
  }, 900_000);

  it("the /frame still equals the MP4 frame", async () => {
    const inputProps: CaptionVideoProps = {
      videoSrc, sourceKind: "video", template: getCaptionTemplate("clean"), width: 1080, height: 1920, phrases: [], durationMs: 2000,
      brand: templateLook(getCaptionTemplate("clean")), overlays: [], motionGraphics: [mgp(frameRed, { endMs: 2000 })],
    };
    const mp4 = await render(inputProps, "mg-still-vs-mp4.mp4");
    const png = join(dir, "mg-still-1000.png");
    await renderer.renderStill({ compositionId: "CaptionVideo", inputProps, timestampMs: 1000, width: 1080, outPath: png });
    const still = [...execFileSync("ffmpeg", ["-v", "error", "-i", png, "-vf", "crop=2:2:540:960", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])].slice(0, 3);
    expect(still[0]).toBeGreaterThan(100); // frame 30 → rgb(120, 0, 0)
    expect(Math.abs(still[0] - pixelAt(mp4, 30, 540, 960)[0])).toBeLessThanOrEqual(6);
  }, 900_000);

  it("an MG gets the brand fonts", async () => {
    const compiled = `const Component = () => {
  const loaded = [...document.fonts].some((f) => f.family === "Bebas Neue" && f.status === "loaded");
  return React.createElement("div", { style: { position: "absolute", inset: 0, background: loaded ? "#00ff00" : "#ff0000", fontFamily: '"Bebas Neue"', fontSize: 80 } }, "SABI");
};`;
    const out = await render({ phrases: [], durationMs: 1000, motionGraphics: [mgp(compiled, { box: { x: 0, y: 0, w: 1, h: 0.3 } })] }, "mg-font.mp4");
    const [r, g] = pixelAt(out, 15, 900, 450);
    expect(g).toBeGreaterThan(200);
    expect(r).toBeLessThan(60);
  }, 900_000);

  it("a silent MG's still shows ⚠ (the frame its watchdog fires on)", async () => {
    const inputProps: CaptionVideoProps = {
      videoSrc, sourceKind: "video", template: getCaptionTemplate("clean"), width: 1080, height: 1920, phrases: [], durationMs: 1000,
      brand: templateLook(getCaptionTemplate("clean")), overlays: [],
      motionGraphics: [mgp('const Component = () => { Promise.allSettled = () => new Promise(() => {}); return null; };')],
    };
    const png = join(dir, "mg-silent-still.png");
    const { mgProblems } = await renderer.renderStill({ compositionId: "CaptionVideo", inputProps, timestampMs: 500, width: 1080, outPath: png });
    expect(mgProblems).toContainEqual({ mg: "mg-0", kind: "silent", detail: "no answer for 5 s" });
    const [r, g] = [...execFileSync("ffmpeg", ["-v", "error", "-i", png, "-vf", "crop=2:2:6:6", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])].slice(0, 3);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
  }, 900_000);

  it("renderStill returns the MG problems", async () => {
    const inputProps: CaptionVideoProps = {
      videoSrc, sourceKind: "video", template: getCaptionTemplate("clean"), width: 1080, height: 1920, phrases: [], durationMs: 1000,
      brand: templateLook(getCaptionTemplate("clean")), overlays: [], motionGraphics: [
        mgp("const Component = () => { throw new Error('boom'); };", { id: "mg-0" }),
        mgp('const Component = () => React.createElement("img", { src: "https://example.invalid/x.png" });', { id: "mg-1" }),
      ],
    };
    const { mgProblems } = await renderer.renderStill({ compositionId: "CaptionVideo", inputProps, timestampMs: 500, width: 540, outPath: join(dir, "mg-problems.png") });
    expect(mgProblems).toContainEqual({ mg: "mg-0", kind: "threw", detail: "boom" });
    expect(mgProblems.find((p) => p.mg === "mg-1" && p.kind === "blocked")?.detail).toMatch(/^img-src https:\/\/example\.invalid\/x\.png/);
  }, 900_000);
});
