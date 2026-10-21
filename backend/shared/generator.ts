import type { OverlayMedia } from "../../shared/types";

// One edit to change models. Prices (2026-10): flux/schnell ≈ $0.003/image, kling 1.6 standard ≈ $0.25 per 5 s clip.
export const FAL_IMAGE_MODEL = "fal-ai/flux/schnell";
export const FAL_VIDEO_MODEL = "fal-ai/kling-video/v1.6/standard/image-to-video";

export type GenerateRequest = { prompt: string; media: OverlayMedia; width: number; height: number };
export type GeneratedMedia = { url: string; media: OverlayMedia; model: string; costCents: number };

export interface MediaGenerator {
  generate(req: GenerateRequest): Promise<GeneratedMedia>;
}

const unavailable = () => new Error("generator_unavailable");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fal.ai queue REST. A video is image-to-video from a still made for the same prompt (charged as the video only).
export class FalGenerator implements MediaGenerator {
  private baseUrl: string;
  constructor(private apiKey: string, private fetchFn: typeof fetch, private opts: { baseUrl?: string; timeoutMs?: number; pollMs?: number } = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://queue.fal.run").replace(/\/+$/, "");
  }

  async generate({ prompt, media, width, height }: GenerateRequest): Promise<GeneratedMedia> {
    const deadline = Date.now() + (this.opts.timeoutMs ?? 180_000);
    const image = await this.run<{ images?: { url?: string }[] }>(FAL_IMAGE_MODEL, { prompt, image_size: { width, height }, num_images: 1 }, deadline);
    const imageUrl = image.images?.[0]?.url;
    if (!imageUrl) throw unavailable();
    if (media === "image") return { url: imageUrl, media, model: FAL_IMAGE_MODEL, costCents: 1 };
    const aspect_ratio = width > height ? "16:9" : "9:16";
    const video = await this.run<{ video?: { url?: string } }>(FAL_VIDEO_MODEL, { prompt, image_url: imageUrl, duration: "5", aspect_ratio }, deadline);
    if (!video.video?.url) throw unavailable();
    return { url: video.video.url, media, model: FAL_VIDEO_MODEL, costCents: 25 };
  }

  private async run<T>(model: string, input: unknown, deadline: number): Promise<T> {
    const { status_url, response_url } = await this.call<{ status_url: string; response_url: string }>(`${this.baseUrl}/${model}`, deadline, input);
    for (;;) {
      const { status } = await this.call<{ status?: string }>(status_url, deadline);
      if (status === "COMPLETED") return this.call<T>(response_url, deadline);
      if (Date.now() + (this.opts.pollMs ?? 2000) > deadline) throw unavailable();
      await sleep(this.opts.pollMs ?? 2000);
    }
  }

  private async call<T>(url: string, deadline: number, body?: unknown): Promise<T> {
    const left = deadline - Date.now();
    if (left <= 0) throw unavailable();
    const res = await this.fetchFn(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Key ${this.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(left),
    }).catch(() => { throw unavailable(); });
    if (!res.ok) throw unavailable();
    return res.json().catch(() => { throw unavailable(); }) as Promise<T>;
  }
}

export class FakeGenerator implements MediaGenerator {
  calls: GenerateRequest[] = [];
  constructor(private urlFor: (req: GenerateRequest) => string | Error) {}
  async generate(req: GenerateRequest): Promise<GeneratedMedia> {
    this.calls.push(req);
    const url = this.urlFor(req);
    if (url instanceof Error) throw url;
    return req.media === "image" ? { url, media: "image", model: FAL_IMAGE_MODEL, costCents: 1 } : { url, media: "video", model: FAL_VIDEO_MODEL, costCents: 25 };
  }
}
