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

export interface Renderer { render(req: RenderRequest): Promise<void> }

// Bundles shared/remotion once per process, then renders with headless Chromium (downloaded by Remotion on first use).
export class RemotionRenderer implements Renderer {
  private serveUrl: Promise<string> | null = null;
  constructor(private opts: { entry: string; bundleDir: string; browserExecutable?: string | null }) {}

  private bundleOnce() {
    this.serveUrl ??= import("@remotion/bundler").then(({ bundle }) =>
      bundle({ entryPoint: resolve(this.opts.entry), outDir: resolve(this.opts.bundleDir) }));
    return this.serveUrl;
  }

  async render(req: RenderRequest) {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const inputProps = { ...req.inputProps, durationMs: req.durationMs };
    const browserExecutable = this.opts.browserExecutable === undefined ? defaultBrowserExecutable() : this.opts.browserExecutable;
    const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps, browserExecutable });
    await renderMedia({ serveUrl, composition, codec: "h264", crf: 18, inputProps, outputLocation: req.outPath, browserExecutable });
  }
}

export class FakeRenderer implements Renderer {
  calls: RenderRequest[] = [];
  async render(req: RenderRequest) { this.calls.push(req); await writeFile(req.outPath, "fake-mp4"); }
}
