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

  it("replays the last job on connect when it failed (a reload still says why), never a finished one", async () => {
    const deps = makeTestDeps();
    const server = createApp(deps).listen(0);
    const port = (server.address() as AddressInfo).port;
    deps.jobs.handle("boom", async () => { throw new Error("transcriber_unavailable"); });
    deps.jobs.handle("quick", async () => {});
    await deps.jobs.enqueue("p1", "boom", { input: {}, actor: "web", prevStatus: "ready" });
    await deps.jobs.enqueue("p2", "quick", { input: {}, actor: "web", prevStatus: "ready" });
    await vi.waitFor(async () => expect((await deps.jobs.last("p1"))?.state).toBe("FAILED"));
    await vi.waitFor(async () => expect((await deps.jobs.last("p2"))?.state).toBe("COMPLETE"));

    const failed = await readFrames(await fetch(`http://127.0.0.1:${port}/api/projects/p1/events`), 1);
    expect(failed[0]).toContain('"state":"FAILED"');
    expect(failed[0]).toContain('"error":"transcriber_unavailable"');
    const ctrl = new AbortController();
    const replayed = fetch(`http://127.0.0.1:${port}/api/projects/p2/events`, { signal: ctrl.signal }).then((res) => readFrames(res, 1)).catch(() => []);
    const first = await Promise.race([replayed, new Promise<string[]>((r) => setTimeout(() => r([]), 300))]);
    ctrl.abort();
    expect(first).toEqual([]); // a COMPLETE job is not replayed: it would re-fire "done" side effects
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
