import { GENERATION_COST_CENTS } from "../../shared/contract";
import type { OverlayMedia } from "../../shared/types";

// One edit to change models. Prices (2026-10): flux/schnell ≈ $0.003/image, kling 1.6 standard ≈ $0.25 per 5 s clip.
export const FAL_IMAGE_MODEL = "fal-ai/flux/schnell";
export const FAL_VIDEO_MODEL = "fal-ai/kling-video/v1.6/standard/image-to-video";
export const FAL_MODELS: Record<OverlayMedia, { id: string; costCents: number }> = {
  image: { id: FAL_IMAGE_MODEL, costCents: GENERATION_COST_CENTS.image },
  video: { id: FAL_VIDEO_MODEL, costCents: GENERATION_COST_CENTS.video },
};

export type GenerateRequest = { prompt: string; media: OverlayMedia; width: number; height: number };
export type GeneratedMedia = { url: string; media: OverlayMedia; model: string; costCents: number };
// onCharged fires once fal has accepted the paid request: from then on fal runs and bills it, whatever happens to us.
export type GenerateHooks = { onCharged?(charge: { model: string; costCents: number }): Promise<void> };

export interface MediaGenerator {
  generate(req: GenerateRequest, hooks?: GenerateHooks): Promise<GeneratedMedia>;
}

const unavailable = () => new Error("generator_unavailable"); // fal refused or could not be reached: nothing was billed
const timedOut = () => new Error("generator_timeout"); // our deadline passed: an accepted request is still billed
const DEADLINE_MS: Record<OverlayMedia, number> = { image: 180_000, video: 600_000 }; // Kling takes 1–3 min, sometimes more
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fal.ai queue REST. A video is image-to-video from a still made for the same prompt (charged as the video only).
export class FalGenerator implements MediaGenerator {
  private baseUrl: string;
  constructor(private apiKey: string, private fetchFn: typeof fetch, private opts: { baseUrl?: string; timeoutMs?: number; pollMs?: number } = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://queue.fal.run").replace(/\/+$/, "");
  }

  async generate({ prompt, media, width, height }: GenerateRequest, hooks: GenerateHooks = {}): Promise<GeneratedMedia> {
    const deadline = Date.now() + (this.opts.timeoutMs ?? DEADLINE_MS[media]);
    const charge = (m: OverlayMedia) => async () => { await hooks.onCharged?.({ model: FAL_MODELS[m].id, costCents: FAL_MODELS[m].costCents }); };
    // The still is billed as the image itself, or (for a video) folded into the video's price.
    const image = await this.run<{ images?: { url?: string }[] }>(FAL_IMAGE_MODEL, { prompt, image_size: { width, height }, num_images: 1 }, deadline,
      media === "image" ? charge("image") : undefined);
    const imageUrl = image.images?.[0]?.url;
    if (!imageUrl) throw unavailable();
    if (media === "image") return { url: imageUrl, media, model: FAL_MODELS.image.id, costCents: FAL_MODELS.image.costCents };
    const aspect_ratio = width > height ? "16:9" : "9:16";
    const video = await this.run<{ video?: { url?: string } }>(FAL_VIDEO_MODEL, { prompt, image_url: imageUrl, duration: "5", aspect_ratio }, deadline, charge("video"));
    if (!video.video?.url) throw unavailable();
    return { url: video.video.url, media, model: FAL_MODELS.video.id, costCents: FAL_MODELS.video.costCents };
  }

  private async run<T>(model: string, input: unknown, deadline: number, accepted?: () => Promise<void>): Promise<T> {
    const { status_url, response_url } = await this.call<{ status_url: string; response_url: string }>(`${this.baseUrl}/${model}`, deadline, input);
    await accepted?.();
    for (;;) {
      const { status } = await this.call<{ status?: string }>(status_url, deadline);
      if (status === "COMPLETED") return this.call<T>(response_url, deadline);
      if (Date.now() + (this.opts.pollMs ?? 2000) > deadline) throw timedOut();
      await sleep(this.opts.pollMs ?? 2000);
    }
  }

  private async call<T>(url: string, deadline: number, body?: unknown): Promise<T> {
    const left = deadline - Date.now();
    if (left <= 0) throw timedOut();
    const res = await this.fetchFn(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Key ${this.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(left),
    }).catch((err: Error) => { throw err.name === "TimeoutError" ? timedOut() : unavailable(); });
    if (!res.ok) throw unavailable();
    return res.json().catch(() => { throw unavailable(); }) as Promise<T>;
  }
}

// An Error("generator_timeout") stands for a request fal accepted (and billed) that then ran out of time; other errors were refused.
export class FakeGenerator implements MediaGenerator {
  calls: GenerateRequest[] = [];
  constructor(private urlFor: (req: GenerateRequest) => string | Error) {}
  async generate(req: GenerateRequest, hooks: GenerateHooks = {}): Promise<GeneratedMedia> {
    this.calls.push(req);
    const url = this.urlFor(req);
    const model = FAL_MODELS[req.media];
    if (url instanceof Error && url.message !== "generator_timeout") throw url;
    await hooks.onCharged?.({ model: model.id, costCents: model.costCents });
    if (url instanceof Error) throw url;
    return { url, media: req.media, model: model.id, costCents: model.costCents };
  }
}
