import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  constructor(private opts: { entry: string; bundleDir: string }) {}

  private bundleOnce() {
    this.serveUrl ??= import("@remotion/bundler").then(({ bundle }) =>
      bundle({ entryPoint: resolve(this.opts.entry), outDir: resolve(this.opts.bundleDir) }));
    return this.serveUrl;
  }

  async render(req: RenderRequest) {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const inputProps = { ...req.inputProps, durationMs: req.durationMs };
    const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps });
    await renderMedia({ serveUrl, composition, codec: "h264", crf: 18, inputProps, outputLocation: req.outPath });
  }
}

export class FakeRenderer implements Renderer {
  calls: RenderRequest[] = [];
  async render(req: RenderRequest) { this.calls.push(req); await writeFile(req.outPath, "fake-mp4"); }
}
