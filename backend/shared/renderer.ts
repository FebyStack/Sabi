import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Segment } from "../../shared/editing/cuts";
import { parseMgLog } from "../../shared/remotion/mgProtocol";
import type { MgProblem } from "../../shared/types";

// null = Remotion's own chrome-headless-shell (downloaded once into node_modules/.remotion). The installed Google
// Chrome renders ~4× slower (it waits on its frame clock for every screenshot); REMOTION_BROWSER_EXECUTABLE overrides.
export const defaultBrowserExecutable = () => process.env.REMOTION_BROWSER_EXECUTABLE ?? null;
// In the temp folder (the npm scripts put TMPDIR on the Mac disk), one per checkout so parallel worktrees don't collide.
export const defaultBundleDir = () => join(tmpdir(), `sabi-remotion-bundle-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8)}`);

// Audio fades at cuts (video-use style). Remotion applies volume per video frame (33 ms steps), which still clicks,
// so the export fades per sample in ffmpeg: the gain falls to 0 over the last 15 ms before each join and rises over 15 ms after.
export const CUT_FADE_MS = 15;
export function outputCutTimesMs(segments: Segment[] | undefined): number[] {
  const joins: number[] = [];
  let at = 0;
  for (const s of (segments ?? []).slice(0, -1)) { at += s.endMs - s.startMs; joins.push(at); }
  return joins;
}
export function cutFadeFilter(cutsMs: number[]): string {
  const sec = (ms: number) => (ms / 1000).toFixed(3);
  // Distance to the nearest cut as a binary search over the sorted cuts (ffmpeg's if() is lazy): 80 cuts as min() of all added ~5 s per minute of audio.
  const near = (lo: number, hi: number): string => {
    if (lo === hi) return `abs(t-${sec(cutsMs[lo])})`;
    const mid = (lo + hi) >> 1;
    return `if(lt(t,${sec((cutsMs[mid] + cutsMs[mid + 1]) / 2)}),${near(lo, mid)},${near(mid + 1, hi)})`;
  };
  return `aeval='val(ch)*min(1,${near(0, cutsMs.length - 1)}/${sec(CUT_FADE_MS)})':c=same`;
}
const run = promisify(execFile);

// The bundle is code the render browser runs: refuse a folder another user could have planted (symlink, foreign owner, writable by others).
export async function ownBundleDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await lstat(dir);
  const foreign = typeof process.getuid === "function" && st.uid !== process.getuid();
  if (st.isSymbolicLink() || !st.isDirectory() || foreign || (st.mode & 0o022) !== 0) throw new Error(`unsafe_bundle_dir: ${dir}`);
}

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

// What a still's motion graphics reported from their sandboxes (spec row 26); render_frame shows it to the agent.
export type StillResult = { mgProblems: MgProblem[] };

export interface Renderer {
  render(req: RenderRequest): Promise<void>;
  renderStill(req: StillRequest): Promise<StillResult>;
  warm?(): Promise<void>; // bundle + open the browser ahead of the first render
  close?(): Promise<void>; // shut the shared browser (process exit)
}

// Bundles shared/remotion once per process and renders in one shared headless browser.
export class RemotionRenderer implements Renderer {
  private serveUrl: Promise<string> | null = null;
  private browsers = sharedBrowser(async () => {
    const { openBrowser } = await import("@remotion/renderer");
    return openBrowser("chrome", { browserExecutable: this.browserExecutable() });
  });
  // publicDir: frontend/public holds mg-sandbox.html, the page every motion graphic runs in (spec row 24).
  constructor(private opts: { entry: string; bundleDir?: string; browserExecutable?: string | null; publicDir?: string }) {}

  private bundleOnce() {
    const outDir = resolve(this.opts.bundleDir ?? defaultBundleDir());
    this.serveUrl ??= ownBundleDir(outDir).then(() => import("@remotion/bundler")).then(({ bundle }) => bundle({ entryPoint: resolve(this.opts.entry), outDir, publicDir: resolve(this.opts.publicDir ?? "frontend/public") }))
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

  async close() { await this.browsers.reset(); }

  async render(req: RenderRequest) {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const inputProps = { ...req.inputProps, durationMs: req.durationMs };
    const browserExecutable = this.browserExecutable();
    const cuts = outputCutTimesMs(req.inputProps.segments);
    // With cuts: picture and audio come out separately and ffmpeg muxes them, fading at each join (one AAC encode).
    const video = cuts.length ? `${req.outPath}.video.mp4` : req.outPath, audio = `${req.outPath}.audio.wav`;
    await this.withBrowser(async (puppeteerInstance) => {
      const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps, browserExecutable, puppeteerInstance });
      await renderMedia({ serveUrl, composition, codec: "h264", crf: 18, inputProps, outputLocation: video, browserExecutable, puppeteerInstance, scale: req.scale,
        ...(cuts.length ? { separateAudioTo: audio } : {}) });
    });
    if (!cuts.length) return;
    try {
      await run("ffmpeg", ["-v", "error", "-y", "-protocol_whitelist", "file", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-af", cutFadeFilter(cuts), "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", `${req.outPath}.muxed.mp4`]);
      await rename(`${req.outPath}.muxed.mp4`, req.outPath);
    } finally {
      await Promise.all([rm(video, { force: true }), rm(audio, { force: true }), rm(`${req.outPath}.muxed.mp4`, { force: true })]);
    }
  }

  async renderStill(req: StillRequest): Promise<StillResult> {
    const { renderStill, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundleOnce();
    const browserExecutable = this.browserExecutable();
    const lines = new Set<string>();
    await this.withBrowser(async (puppeteerInstance) => {
      const composition = await selectComposition({ serveUrl, id: req.compositionId, inputProps: req.inputProps, browserExecutable, puppeteerInstance });
      // t = durationMs maps one past the last frame; clamp so the end of the timeline never crashes Remotion.
      const frame = Math.min(Math.round((req.timestampMs / 1000) * composition.fps), composition.durationInFrames - 1);
      await renderStill({
        serveUrl, composition, frame, inputProps: req.inputProps, output: req.outPath, imageFormat: "png",
        scale: req.width / composition.width, browserExecutable, puppeteerInstance,
        onBrowserLog: (log) => { if (parseMgLog(log.text)) lines.add(log.text); },
      });
    });
    return { mgProblems: [...lines].map((l) => parseMgLog(l)!) };
  }
}

// Smallest valid PNG (1×1), so tests and FAKE renders return real image bytes.
export const PNG_1x1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export class FakeRenderer implements Renderer {
  calls: RenderRequest[] = [];
  stillCalls: StillRequest[] = [];
  stillProblems: MgProblem[] = [];
  async render(req: RenderRequest) { this.calls.push(req); await writeFile(req.outPath, "fake-mp4"); }
  async renderStill(req: StillRequest) {
    this.stillCalls.push(req);
    await writeFile(req.outPath, Buffer.from(PNG_1x1_BASE64, "base64"));
    return { mgProblems: this.stillProblems };
  }
}
