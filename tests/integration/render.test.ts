import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemotionRenderer } from "../../backend/shared/renderer";
import { getCaptionTemplate } from "../../shared/captions/templates";
import type { Phrase } from "../../shared/types";

// Real Chromium render; opt in with RUN_RENDER=1 (npm run render:sample).
describe.skipIf(process.env.RUN_RENDER !== "1")("RemotionRenderer", () => {
  it("renders captions over a generated clip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "render-"));
    const clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=2:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    const phrases: Phrase[] = [{
      id: "ph-0", startMs: 100, endMs: 1900, lineBreaksAfter: [1],
      words: [
        { id: "w-0", text: "Hello", startMs: 100, endMs: 700 },
        { id: "w-1", text: "captions", startMs: 700, endMs: 1300 },
        { id: "w-2", text: "world", startMs: 1300, endMs: 1900 },
      ],
    }];
    // Chromium needs an http(s) URL for the source video, same as the API serves in production.
    const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "video/mp4" }); createReadStream(clip).pipe(res); }).listen(0);
    const videoSrc = `http://127.0.0.1:${(server.address() as AddressInfo).port}/clip.mp4`;
    const outPath = join(dir, "out.mp4");
    try {
      await new RemotionRenderer({ entry: "shared/remotion/index.ts", bundleDir: join(dir, "bundle") }).render({
        compositionId: "CaptionVideo",
        inputProps: { videoSrc, phrases, template: getCaptionTemplate("clean"), width: 1080, height: 1920, durationMs: 2000 },
        durationMs: 2000,
        outPath,
      });
    } finally { server.close(); }
    expect(statSync(outPath).size).toBeGreaterThan(10_000);
  }, 900_000); // webpack bundle + Chromium render on the ExFAT SSD is slow the first time
});
