import type { OverlayMedia } from "../../shared/types";

export type StockResult = { url: string; media: OverlayMedia; width: number; height: number; durationMs?: number; attribution: { author: string; url: string } };
export type StockQuery = { media: OverlayMedia; orientation: "portrait" | "landscape"; page?: number };

export interface StockSearch {
  search(query: string, opts: StockQuery): Promise<StockResult[]>;
}

type PexelsPhoto = { width: number; height: number; url: string; photographer: string; src: { large2x: string } };
type PexelsVideo = { duration: number; url: string; user: { name: string }; video_files: { file_type: string; width: number; height: number; link: string }[] };

const MAX_VIDEO_S = 30;
const MAX_VIDEO_W = 1920;

// Pexels REST (free key, 200 req/h). Any failure — rate limit, network, bad JSON — is one error the job can fall back on.
export class PexelsStock implements StockSearch {
  private baseUrl: string;
  constructor(private apiKey: string, private fetchFn: typeof fetch, private opts: { baseUrl?: string; timeoutMs?: number } = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.pexels.com").replace(/\/+$/, "");
  }

  async search(query: string, { media, orientation, page = 1 }: StockQuery): Promise<StockResult[]> {
    const params = new URLSearchParams({ query, orientation, per_page: "10", page: String(page) });
    if (media === "video") params.set("size", "medium");
    const body = await this.get(`${media === "image" ? "/v1/search" : "/videos/search"}?${params}`);
    if (media === "image") {
      return ((body.photos ?? []) as PexelsPhoto[]).map((p) => ({
        url: p.src.large2x, media, width: p.width, height: p.height, attribution: { author: p.photographer, url: p.url },
      }));
    }
    return ((body.videos ?? []) as PexelsVideo[]).flatMap((v) => {
      const file = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width <= MAX_VIDEO_W).sort((a, b) => b.width - a.width)[0];
      if (!file || v.duration > MAX_VIDEO_S) return [];
      return [{ url: file.link, media, width: file.width, height: file.height, durationMs: v.duration * 1000, attribution: { author: v.user.name, url: v.url } }];
    });
  }

  private async get(path: string): Promise<{ photos?: unknown[]; videos?: unknown[] }> {
    const unavailable = () => new Error("stock_unavailable");
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { authorization: this.apiKey }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    }).catch(() => { throw unavailable(); });
    if (!res.ok) throw unavailable();
    return res.json().catch(() => { throw unavailable(); });
  }
}

export class FakeStock implements StockSearch {
  calls: { query: string; opts: StockQuery }[] = [];
  constructor(private respond: (query: string, opts: StockQuery) => StockResult[]) {}
  async search(query: string, opts: StockQuery) {
    this.calls.push({ query, opts });
    return this.respond(query, opts);
  }
}
