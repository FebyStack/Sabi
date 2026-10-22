import { existsSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../../app/app";
import { FakeMedia } from "../../shared/media";
import { PNG_1x1_BASE64 } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";

describe("assets", () => {
  it("uploads a video and probes it", async () => {
    const a = createApp(makeTestDeps());
    const start = await request(a).post("/api/assets/uploads/start").send({ fileName: "clip.mp4", mimeType: "video/mp4", sizeBytes: 5 });
    expect(start.status).toBe(200);
    const { uploadId } = start.body;
    expect((await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from("hello"))).status).toBe(204);
    const done = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ kind: "video", mimeType: "video/mp4", sizeBytes: 5, durationMs: 21000, width: 1080, height: 1920 });
    const file = await request(a).get(`/api/assets/${done.body.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("video/mp4");
    expect(file.body.toString()).toBe("hello");
  });

  it("uploads a png as an image asset", async () => {
    const a = createApp(makeTestDeps({ media: new FakeMedia({ durationMs: 0, width: 1, height: 1 }) }));
    const png = Buffer.from(PNG_1x1_BASE64, "base64");
    const start = await request(a).post("/api/assets/uploads/start").send({ fileName: "logo.png", mimeType: "image/png", sizeBytes: png.length });
    expect(start.status).toBe(200);
    const { uploadId } = start.body;
    expect((await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "image/png").send(png)).status).toBe(204);
    const done = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ kind: "image", mimeType: "image/png", key: `uploads/${uploadId}.png`, width: 1, height: 1 });
    const file = await request(a).get(`/api/assets/${done.body.id}/file`);
    expect(file.headers["content-type"]).toContain("image/png");
  });

  it("caps image uploads at 50 MiB and 8192 px", async () => {
    const a = createApp(makeTestDeps({ media: new FakeMedia({ durationMs: 0, width: 9000, height: 10 }) }));
    expect((await request(a).post("/api/assets/uploads/start").send({ fileName: "x.png", mimeType: "image/png", sizeBytes: 50 * 1024 ** 2 + 1 })).status).toBe(413);
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "x.png", mimeType: "image/png", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "image/png").send(Buffer.from("hello"));
    const done = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    expect(done.status).toBe(422);
    expect(done.body.error).toBe("too_large_image");
  });

  it("rejects an image whose probe finds no dimensions", async () => {
    const deps = makeTestDeps({ media: new FakeMedia({ durationMs: 0 }) });
    const a = createApp(deps);
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "x.png", mimeType: "image/png", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "image/png").send(Buffer.from("hello"));
    const done = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    expect(done.status).toBe(422);
    expect(done.body.error).toBe("bad_image");
    expect(await deps.storage.stat(`uploads/${uploadId}.png`)).toBeNull();
  });

  it("rejects oversized and wrong mime", async () => {
    const a = createApp(makeTestDeps());
    expect((await request(a).post("/api/assets/uploads/start").send({ fileName: "x.mp4", mimeType: "video/mp4", sizeBytes: 2 * 1024 ** 3 + 1 })).status).toBe(413);
    expect((await request(a).post("/api/assets/uploads/start").send({ fileName: "x.gif", mimeType: "image/gif", sizeBytes: 10 })).status).toBe(415);
  });

  it("done on unknown upload is 404", async () => {
    expect((await request(createApp(makeTestDeps())).post("/api/assets/uploads/nope/done").send({})).status).toBe(404);
  });

  it("rejects a PUT that exceeds the declared size and discards the bytes", async () => {
    const deps = makeTestDeps();
    const a = createApp(deps);
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: 5 });
    const put = await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from("0123456789"));
    expect(put.status).toBe(413);
    expect(await deps.storage.stat(`uploads/${uploadId}.mp4`)).toBeNull();
    expect((await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({})).status).toBe(409);
  });

  it("rejects clips longer than 10 minutes", async () => {
    const a = createApp(makeTestDeps({ media: new FakeMedia({ durationMs: 600_001, width: 1080, height: 1920 }) }));
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from("hello"));
    const done = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    expect(done.status).toBe(422);
    expect(done.body.error).toBe("too_long");
  });

  it("rejects done and a second PUT while a PUT is still streaming, and drops the file on client abort", async () => {
    const deps = makeTestDeps();
    const server = createApp(deps).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { uploadId } = await (await fetch(`${base}/api/assets/uploads/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: 100 }) })).json();
    let push!: (chunk: Uint8Array | null) => void;
    const body = new ReadableStream<Uint8Array>({ start(c) { push = (chunk) => (chunk ? c.enqueue(chunk) : c.close()); } });
    const ac = new AbortController();
    const put = fetch(`${base}/api/assets/uploads/${uploadId}`, { method: "PUT", headers: { "content-type": "video/mp4" }, body, duplex: "half", signal: ac.signal } as RequestInit).catch(() => null);
    push(new TextEncoder().encode("hello"));
    const work = deps.storage.workPath(`uploads/${uploadId}.mp4`); // bytes stream to a scratch file until done() accepts them
    await vi.waitFor(() => expect(existsSync(work)).toBe(true));
    expect((await fetch(`${base}/api/assets/uploads/${uploadId}/done`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(409);
    expect((await fetch(`${base}/api/assets/uploads/${uploadId}`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: "x" })).status).toBe(409);
    ac.abort();
    await put;
    await vi.waitFor(() => expect(existsSync(work)).toBe(false));
    expect(await deps.storage.stat(`uploads/${uploadId}.mp4`)).toBeNull();
    server.close();
  });

  it("serves byte ranges and 404s a missing file instead of crashing", async () => {
    const deps = makeTestDeps();
    const a = createApp(deps);
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from("hello"));
    const { body: asset } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    const range = await request(a).get(`/api/assets/${asset.id}/file`).set("range", "bytes=1-2");
    expect(range.status).toBe(206);
    expect(range.body.toString()).toBe("el");
    await deps.storage.remove(asset.key);
    expect((await request(a).get(`/api/assets/${asset.id}/file`)).status).toBe(404);
  });

  it("serves byte ranges like a static file server", async () => {
    const deps = makeTestDeps();
    const a = createApp(deps);
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: 1000 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(bytes);
    const { body: asset } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    const get = (range?: string) => {
      const r = request(a).get(`/api/assets/${asset.id}/file`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
      return range ? r.set("range", range) : r;
    };
    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.headers).toMatchObject({ "accept-ranges": "bytes", "content-length": "1000", "content-type": "video/mp4", "x-content-type-options": "nosniff" });
    expect(whole.body).toEqual(bytes);
    const from0 = await get("bytes=0-");
    expect([from0.status, from0.headers["content-range"], from0.body.length]).toEqual([206, "bytes 0-999/1000", 1000]);
    const mid = await get("bytes=100-199");
    expect([mid.status, mid.headers["content-range"], mid.headers["content-length"]]).toEqual([206, "bytes 100-199/1000", "100"]);
    expect(mid.body).toEqual(bytes.subarray(100, 200));
    const tail = await get("bytes=-500");
    expect([tail.status, tail.headers["content-range"]]).toEqual([206, "bytes 500-999/1000"]);
    expect(tail.body).toEqual(bytes.subarray(500));
    const past = await get("bytes=2000-");
    expect([past.status, past.headers["content-range"]]).toEqual([416, "bytes */1000"]);
    await deps.storage.remove(asset.key);
    expect((await get()).status).toBe(404);
  });

  it("a file is cached for good under its asset id (its bytes never change); a revalidation gets 304; errors are not cached", async () => {
    const deps = makeTestDeps();
    const a = createApp(deps);
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from("hello"));
    const { body: asset } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    const cached = { "cache-control": "private, max-age=31536000, immutable", etag: `"${asset.id}"` };
    expect((await request(a).get(`/api/assets/${asset.id}/file`)).headers).toMatchObject(cached);
    expect((await request(a).get(`/api/assets/${asset.id}/file`).set("range", "bytes=1-2")).headers).toMatchObject(cached);
    const again = await request(a).get(`/api/assets/${asset.id}/file`).set("if-none-match", `"${asset.id}"`);
    expect([again.status, again.text]).toEqual([304, ""]);
    expect(again.headers).toMatchObject(cached);
    expect((await request(a).get(`/api/assets/${asset.id}/file`).set("if-none-match", `"other"`)).status).toBe(200);
    expect((await request(a).get(`/api/assets/${asset.id}/file`).set("range", "bytes=99-")).headers["cache-control"]).toBeUndefined(); // 416
    await deps.storage.remove(asset.key);
    expect((await request(a).get(`/api/assets/${asset.id}/file`)).headers["cache-control"]).toBeUndefined(); // 404 file_missing
  });

  it("an uploaded file is sanitized before it is stored", async () => {
    const calls: [string, string, string][] = [];
    class CleaningMedia extends FakeMedia {
      async sanitize(input: string, output: string, kind: "image" | "av") { calls.push([input, output, kind]); writeFileSync(output, "CLEAN"); }
    }
    const deps = makeTestDeps({ media: new CleaningMedia({ durationMs: 0, width: 40, height: 20 }) });
    const a = createApp(deps);
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "image/jpeg").send(Buffer.from("hello"));
    const { body: asset } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    expect(calls).toEqual([[deps.storage.workPath(`uploads/${uploadId}.jpg`), expect.stringMatching(/\.jpg$/), "image"]]);
    expect((await request(a).get(`/api/assets/${asset.id}/file`)).body.toString()).toBe("CLEAN"); // the original bytes never reach storage
    expect(asset.sizeBytes).toBe(5); // the stored (clean) file's size
    expect(existsSync(calls[0][0]) || existsSync(calls[0][1])).toBe(false); // no scratch left
  });

  it("a file the sanitizer can't read is refused, not stored", async () => {
    class BrokenMedia extends FakeMedia { async sanitize(): Promise<void> { throw new Error("corrupt"); } }
    const deps = makeTestDeps({ media: new BrokenMedia({ durationMs: 1000, width: 40, height: 20 }) });
    const a = createApp(deps);
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from("hello"));
    const done = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    expect([done.status, done.body]).toEqual([422, { error: "bad_media" }]);
    expect(await deps.storage.stat(`uploads/${uploadId}.mp4`)).toBeNull();
    await vi.waitFor(() => expect(existsSync(deps.storage.workPath(`uploads/${uploadId}.mp4`))).toBe(false)); // cleanup finishes after the reply
  });
});

