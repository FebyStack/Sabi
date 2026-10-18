import request from "supertest";
import { createApp } from "../../app/app";
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
});
