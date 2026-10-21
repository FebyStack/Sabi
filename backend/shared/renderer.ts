import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// null = Remotion's own chrome-headless-shell (downloaded once into node_modules/.remotion). The installed Google
// Chrome renders ~4× slower (it waits on its frame clock for every screenshot); REMOTION_BROWSER_EXECUTABLE overrides.
export const defaultBrowserExecutable = () => process.env.REMOTION_BROWSER_EXECUTABLE ?? null;
// In the temp folder (the npm scripts put TMPDIR on the Mac disk), one per checkout so parallel worktrees don't collide.
export const defaultBundleDir = () => join(tmpdir(), `sabi-remotion-bundle-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8)}`);

// One browser per process, opened on first use and shared by every render and still (a launch costs ~0.5–1.5 s).
// After a failed render the browser is closed and the next call opens a fresh one; a failed launch is not cached.
export function sharedBrowser<B extends { close: (opts: { silent: boolean }) => Promise<void> }>(open: () => Promise<B>) {
  let current: Promise<B> | null = null;
  return {
    get(): Promise<B> {
      current ??= open().catch((err) => { current = null; throw err; });
      return current;
    },
    async reset() {
      const b = current;
      current = null;
      await b?.then((x) => x.close({ silent: true }), () => {});
    },
  };
}
import type { CaptionVideoProps } from "../../shared/remotion/CaptionVideo";

export interface RenderRequest {
  compositionId: "CaptionVideo";
  inputProps: CaptionVideoProps;
  durationMs: number;
  outPath: string;
  scale: 1 | 2; // 2 = 4K (Remotion scales the 1080p composition)
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
  warm?(): Promise<void>; // bundle + open the browser ahead of the first render
}

// Bundles shared/remotion once per process and renders in one shared headless browser.
export class RemotionRenderer implements Renderer {
  private serveUrl: Promise<string> | null = null;
  private browsers = sharedBrowser(async () => {
    const { openBrowser } = await import("@remotion/renderer");
    return openBrowser("chrome", { browserExecutable: this.browserExecutable() });
  });
  constructor(private opts: { entry: string; bundleDir?: string; browserExecutable?: string | null }) {}

  private bundleOnce() {
    this.serveUrl ??= import("@remotion/bundler").then(({ bundle }) =>
      bundle({ entryPoint: resolve(this.opts.entry), outDir: resolve(this.opts.bundleDir ?? defaultBundleDir()) }))
      .catch((err) => { this.serveUrl = null; throw err; });
    return this.serveUrl;
  }

  private browserExecutable() { return this.opts.browserExecutable === undefined ? defaultBrowserExecutable() : this.opts.browserExecutable; }

  // A failed render may have left the browser broken: start the next one with a fresh browser.
  private async withBrowser<T>(fn: (b: Awaited<ReturnType<typeof this.browsers.get>>) => Promise<T>): Promise<T> {
    const b = await this.browsers.get();
    try { return await fn(b); } catch (err) { await this.browsers.reset(); throw err; }
  }

  async warm() { await Promise.all([this.bundleOnce(), this.browsers.get()]); }

  async render(req: RenderRequest) {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const inputProps = { ...req.inputProps, durationMs: req.durationMs };
    const browserExecutable = this.browserExecutable();
    await this.withBrowser(async (puppeteerInstance) => {
      const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps, browserExecutable, puppeteerInstance });
      await renderMedia({ serveUrl, composition, codec: "h264", crf: 18, inputProps, outputLocation: req.outPath, browserExecutable, puppeteerInstance, scale: req.scale });
    });
  }

  async renderStill(req: StillRequest) {
    const { renderStill, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const browserExecutable = this.browserExecutable();
    await this.withBrowser(async (puppeteerInstance) => {
      const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps: req.inputProps, browserExecutable, puppeteerInstance });
      // t = durationMs maps one past the last frame; clamp so the end of the timeline never crashes Remotion.
      const frame = Math.min(Math.round((req.timestampMs / 1000) * composition.fps), composition.durationInFrames - 1);
      await renderStill({
        serveUrl, composition, frame, inputProps: req.inputProps, output: req.outPath, imageFormat: "png",
        scale: req.width / composition.width, browserExecutable, puppeteerInstance,
      });
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
