import type { AddressInfo } from "node:net";
import { createApp } from "../../app/app";
import request from "supertest";
import { holdJob } from "../../shared/apiTestHelpers";
import { makeTestDeps } from "../../shared/testing";

async function readFrames(res: Response, count: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const frames: string[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const f = buf.slice(0, i); buf = buf.slice(i + 2);
      if (f.startsWith("event:")) frames.push(f);
    }
  }
  reader.cancel();
  return frames;
}

describe("project events (SSE)", () => {
  it("streams the active job then live events", async () => {
    const deps = makeTestDeps();
    const server = createApp(deps).listen(0);
    const port = (server.address() as AddressInfo).port;
    const release = await holdJob(deps, "p1", { kind: "captions" });
    await vi.waitFor(async () => expect(await deps.jobs.active("p1")).not.toBeNull());

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/p1/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const framesP = readFrames(res, 2);
    release();
    const frames = await framesP;
    expect(frames[0]).toContain('"state":"PROCESSING"');
    expect(frames[1]).toContain('"state":"COMPLETE"');
    server.close();
  });

  it("replays a failed last job only while the project itself is failed (a reload still says why), never a finished one", async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const project = async (status: string) => {
      const p = (await request(app).post("/api/projects").send({ title: status })).body;
      await deps.projects.update(p.id, { status: status as never });
      return p.id as string;
    };
    deps.jobs.handle("boom", async () => { throw new Error("transcriber_unavailable"); });
    deps.jobs.handle("quick", async () => {});
    const failed = await project("failed"), restored = await project("ready"), done = await project("ready");
    await deps.jobs.enqueue(failed, "boom", { input: {}, actor: "web", prevStatus: "ready" });
    await deps.jobs.enqueue(restored, "boom", { input: {}, actor: "web", prevStatus: "ready" }); // e.g. a failed plan: status back to ready
    await deps.jobs.enqueue(done, "quick", { input: {}, actor: "web", prevStatus: "ready" });
    for (const id of [failed, restored, done]) await vi.waitFor(async () => expect(["FAILED", "COMPLETE"]).toContain((await deps.jobs.last(id))?.state));
    // A stream with nothing to replay never flushes its headers, so the whole request races a short timer.
    const firstFrame = (id: string) => {
      const ctrl = new AbortController();
      const frame = fetch(`http://127.0.0.1:${port}/api/projects/${id}/events`, { signal: ctrl.signal }).then((res) => readFrames(res, 1)).catch(() => []);
      return Promise.race([frame, new Promise<string[]>((r) => setTimeout(() => r([]), 300))]).finally(() => ctrl.abort());
    };

    const replayed = await firstFrame(failed);
    expect(replayed[0]).toContain('"state":"FAILED"');
    expect(replayed[0]).toContain('"error":"transcriber_unavailable"');
    expect(await firstFrame(restored)).toEqual([]); // the project moved on: no stale "Failed: …" on every reload
    expect(await firstFrame(done)).toEqual([]); // a COMPLETE job would re-fire "done" side effects
    server.close();
  });

  it("GET /job?id= returns that job after another finished", async () => {
    const deps = makeTestDeps();
    const a = createApp(deps);
    deps.jobs.handle("quick", async () => ({ assetIds: ["x"] }));
    const first = await deps.jobs.enqueue("p1", "quick", { input: {}, actor: "web", prevStatus: "ready" });
    await vi.waitFor(async () => expect(await deps.jobs.active("p1")).toBeNull());
    const second = await deps.jobs.enqueue("p1", "quick", { input: {}, actor: "web", prevStatus: "ready" });
    await vi.waitFor(async () => expect((await deps.jobs.last("p1"))?.id).toBe(second.id));
    const res = await request(a).get(`/api/projects/p1/job?id=${first.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: first.id, state: "COMPLETE", result: { assetIds: ["x"] } });
    expect((await request(a).get("/api/projects/p1/job?id=nope")).status).toBe(404);
    expect((await request(a).get("/api/projects/p1/job")).body.id).toBe(second.id); // without id: active ?? last, as before
  });
});
