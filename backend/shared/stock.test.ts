import { PexelsStock } from "./stock";

// A fetch that records every URL and answers from a table keyed by path.
const fakeFetch = (answer: (url: URL) => Response) => {
  const urls: URL[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(url);
    expect(new Headers(init?.headers).get("authorization")).toBe("key-1");
    return answer(url);
  }) as typeof fetch;
  return { fn, urls };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const photo = { id: 1, width: 4000, height: 6000, url: "https://www.pexels.com/photo/1", photographer: "Jane Doe", src: { large2x: "https://images.pexels.com/1-large2x.jpg", original: "https://images.pexels.com/1.jpg" } };
const file = (width: number, height: number, link: string, file_type = "video/mp4") => ({ file_type, width, height, link });
const video = (id: number, duration: number, files: unknown[]) => ({ id, duration, url: `https://www.pexels.com/video/${id}`, user: { name: "Vid Eo" }, video_files: files });

describe("PexelsStock", () => {
  it("pexels query carries orientation", async () => {
    const { fn, urls } = fakeFetch(() => json({ photos: [] }));
    await new PexelsStock("key-1", fn).search("glass of water", { media: "image", orientation: "portrait", page: 2 });
    expect(urls[0].origin + urls[0].pathname).toBe("https://api.pexels.com/v1/search");
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ query: "glass of water", orientation: "portrait", per_page: "10", page: "2" });
  });

  it("maps photo and video results", async () => {
    const { fn, urls } = fakeFetch((url) => url.pathname === "/v1/search" ? json({ photos: [photo] }) : json({
      videos: [
        video(2, 12, [file(640, 1138, "https://v/2-sd.mp4"), file(1080, 1920, "https://v/2-hd.mp4"), file(2160, 3840, "https://v/2-4k.mp4"), file(1080, 1920, "https://v/2.webm", "video/webm")]),
        video(3, 45, [file(1080, 1920, "https://v/3.mp4")]), // too long
        video(4, 10, [file(2160, 3840, "https://v/4-4k.mp4")]), // only a 4K file
      ],
    }));
    const stock = new PexelsStock("key-1", fn);
    expect(await stock.search("water", { media: "image", orientation: "portrait" })).toEqual([
      { url: "https://images.pexels.com/1-large2x.jpg", media: "image", width: 4000, height: 6000, attribution: { author: "Jane Doe", url: "https://www.pexels.com/photo/1" } },
    ]);
    expect(await stock.search("water", { media: "video", orientation: "landscape" })).toEqual([
      { url: "https://v/2-hd.mp4", media: "video", width: 1080, height: 1920, durationMs: 12000, attribution: { author: "Vid Eo", url: "https://www.pexels.com/video/2" } },
    ]);
    expect(urls[1].pathname).toBe("/videos/search");
    expect(urls[1].searchParams.get("size")).toBe("medium");
    expect(urls[1].searchParams.get("orientation")).toBe("landscape");
  });

  it("429 throws stock_unavailable", async () => {
    const { fn } = fakeFetch(() => json({ error: "rate limited" }, 429));
    await expect(new PexelsStock("key-1", fn).search("x", { media: "image", orientation: "portrait" })).rejects.toThrow("stock_unavailable");
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(new PexelsStock("key-1", down).search("x", { media: "image", orientation: "portrait" })).rejects.toThrow("stock_unavailable");
  });

  it("no hits returns []", async () => {
    const { fn } = fakeFetch((url) => json(url.pathname === "/v1/search" ? { photos: [] } : { videos: [] }));
    expect(await new PexelsStock("key-1", fn).search("x", { media: "image", orientation: "portrait" })).toEqual([]);
    expect(await new PexelsStock("key-1", fn).search("x", { media: "video", orientation: "portrait" })).toEqual([]);
  });
});
