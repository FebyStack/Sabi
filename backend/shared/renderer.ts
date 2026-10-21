import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Remotion's downloaded chrome-headless-shell does not start from the ExFAT SSD; prefer an installed Chrome.
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const defaultBrowserExecutable = () => process.env.REMOTION_BROWSER_EXECUTABLE ?? (existsSync(MAC_CHROME) ? MAC_CHROME : null);
import type { CaptionVideoProps } from "../../shared/remotion/CaptionVideo";

export interface RenderRequest {
  compositionId: "CaptionVideo";
  inputProps: CaptionVideoProps;
  durationMs: number;
  outPath: string;
}

export interface StillRequest {
  compositionId: "CaptionVideo";
  inputProps: CaptionVideoProps;
  timestampMs: number;
  width: number; // output PNG width; height follows the composition's aspect ratio
  outPath: string;
}

export interface Renderer {
  render(req: RenderRequest): Promise<void>;
  renderStill(req: StillRequest): Promise<void>;
}

// Bundles shared/remotion once per process, then renders with headless Chromium (downloaded by Remotion on first use).
export class RemotionRenderer implements Renderer {
  private serveUrl: Promise<string> | null = null;
  constructor(private opts: { entry: string; bundleDir: string; browserExecutable?: string | null }) {}

  private bundleOnce() {
    this.serveUrl ??= import("@remotion/bundler").then(({ bundle }) =>
      bundle({ entryPoint: resolve(this.opts.entry), outDir: resolve(this.opts.bundleDir) }));
    return this.serveUrl;
  }

  private browser() { return this.opts.browserExecutable === undefined ? defaultBrowserExecutable() : this.opts.browserExecutable; }

  async render(req: RenderRequest) {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const inputProps = { ...req.inputProps, durationMs: req.durationMs };
    const browserExecutable = this.browser();
    const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps, browserExecutable });
    await renderMedia({ serveUrl, composition, codec: "h264", crf: 18, inputProps, outputLocation: req.outPath, browserExecutable });
  }

  async renderStill(req: StillRequest) {
    const { renderStill, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const browserExecutable = this.browser();
    const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps: req.inputProps, browserExecutable });
    // t = durationMs maps one past the last frame; clamp so the end of the timeline never crashes Remotion.
    const frame = Math.min(Math.round((req.timestampMs / 1000) * composition.fps), composition.durationInFrames - 1);
    await renderStill({
      serveUrl, composition, frame, inputProps: req.inputProps, output: req.outPath, imageFormat: "png",
      scale: req.width / composition.width, browserExecutable,
    });
  }
}

// Smallest valid PNG (1×1), so tests and FAKE renders return real image bytes.
export const PNG_1x1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export class FakeRenderer implements Renderer {
  calls: RenderRequest[] = [];
  stillCalls: StillRequest[] = [];
  async render(req: RenderRequest) { this.calls.push(req); await writeFile(req.outPath, "fake-mp4"); }
  async renderStill(req: StillRequest) { this.stillCalls.push(req); await writeFile(req.outPath, Buffer.from(PNG_1x1_BASE64, "base64")); }
}
