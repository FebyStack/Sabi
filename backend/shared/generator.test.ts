import { FAL_IMAGE_MODEL, FAL_VIDEO_MODEL, FalGenerator } from "./generator";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// fal's queue: POST /<model> → urls; GET status until COMPLETED; GET response.
function falQueue(results: Record<string, unknown>, statuses: string[] = ["IN_QUEUE", "COMPLETED"]) {
  const posts: { model: string; body: Record<string, unknown> }[] = [];
  const polls: Record<string, number> = {};
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get("authorization")).toBe("Key fal-1");
    const model = url.pathname.slice(1).replace(/\/requests\/.*$/, "");
    if (init?.method === "POST") {
      posts.push({ model, body: JSON.parse(String(init.body)) });
      const id = `r${posts.length}`;
      return json({ request_id: id, status_url: `https://queue.fal.run/${model}/requests/${id}/status`, response_url: `https://queue.fal.run/${model}/requests/${id}` });
    }
    if (url.pathname.endsWith("/status")) {
      const n = (polls[url.pathname] = (polls[url.pathname] ?? 0) + 1);
      return json({ status: statuses[Math.min(n - 1, statuses.length - 1)] });
    }
    return json(results[model]);
  }) as typeof fetch;
  return { fn, posts, polls };
}

describe("FalGenerator", () => {
  it("fal image queue flow", async () => {
    const { fn, posts, polls } = falQueue({ [FAL_IMAGE_MODEL]: { images: [{ url: "https://fal.media/one.png" }] } });
    const out = await new FalGenerator("fal-1", fn, { pollMs: 1 }).generate({ prompt: "a glass of water", media: "image", width: 1080, height: 1920 });
    expect(out).toEqual({ url: "https://fal.media/one.png", media: "image", model: FAL_IMAGE_MODEL, costCents: 1 });
    expect(posts).toEqual([{ model: FAL_IMAGE_MODEL, body: { prompt: "a glass of water", image_size: { width: 1080, height: 1920 }, num_images: 1 } }]);
    expect(Object.values(polls)).toEqual([2]);
  });

  it("fal video chains image then video and costs 25", async () => {
    const { fn, posts } = falQueue({
      [FAL_IMAGE_MODEL]: { images: [{ url: "https://fal.media/still.png" }] },
      [FAL_VIDEO_MODEL]: { video: { url: "https://fal.media/clip.mp4" } },
    });
    const out = await new FalGenerator("fal-1", fn, { pollMs: 1 }).generate({ prompt: "pouring water", media: "video", width: 1080, height: 1920 });
    expect(out).toEqual({ url: "https://fal.media/clip.mp4", media: "video", model: FAL_VIDEO_MODEL, costCents: 25 });
    expect(posts.map((p) => p.model)).toEqual([FAL_IMAGE_MODEL, FAL_VIDEO_MODEL]);
    expect(posts[1].body).toEqual({ prompt: "pouring water", image_url: "https://fal.media/still.png", duration: "5", aspect_ratio: "9:16" });
  });

  it("timeout throws generator_unavailable", async () => {
    const { fn } = falQueue({}, ["IN_PROGRESS"]);
    await expect(new FalGenerator("fal-1", fn, { timeoutMs: 50, pollMs: 10 }).generate({ prompt: "x", media: "image", width: 1080, height: 1920 }))
      .rejects.toThrow("generator_unavailable");
    const failing = (async () => json({ detail: "bad key" }, 401)) as typeof fetch;
    await expect(new FalGenerator("fal-1", failing).generate({ prompt: "x", media: "image", width: 1080, height: 1920 })).rejects.toThrow("generator_unavailable");
  });
});
