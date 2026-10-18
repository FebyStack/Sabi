import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemotionRenderer } from "../../backend/shared/renderer";
import { getCaptionTemplate } from "../../shared/captions/templates";
import type { CaptionVideoProps } from "../../shared/remotion/CaptionVideo";
import type { Phrase } from "../../shared/types";

const words = [
  { id: "w-0", text: "Hello", startMs: 100, endMs: 700 },
  { id: "w-1", text: "captions", startMs: 700, endMs: 1300 },
  { id: "w-2", text: "world", startMs: 1300, endMs: 1900 },
];

// Real Chromium render; opt in with RUN_RENDER=1 (npm run render:sample).
describe.skipIf(process.env.RUN_RENDER !== "1")("RemotionRenderer", () => {
  let dir: string, videoSrc: string, server: Server, renderer: RemotionRenderer;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "render-"));
    renderer = new RemotionRenderer({ entry: "shared/remotion/index.ts", bundleDir: join(dir, "bundle") }); // one bundle for both cases
    const clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=2:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    // Chromium needs an http(s) URL for the source video, same as the API serves in production.
    server = createServer((_req, res) => { res.writeHead(200, { "content-type": "video/mp4" }); createReadStream(clip).pipe(res); }).listen(0);
    videoSrc = `http://127.0.0.1:${(server.address() as AddressInfo).port}/clip.mp4`;
  });
  afterAll(() => server.close());

  const render = async (props: Partial<CaptionVideoProps> & { phrases: Phrase[]; durationMs: number }, name: string) => {
    const outPath = join(dir, name);
    await renderer.render({
      compositionId: "CaptionVideo",
      inputProps: { videoSrc, sourceKind: "video", template: getCaptionTemplate("clean"), width: 1080, height: 1920, ...props },
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
});
