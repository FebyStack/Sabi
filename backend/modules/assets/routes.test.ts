import request from "supertest";
import { createApp } from "../../app/app";
import { FakeMedia } from "../../shared/media";
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
});
