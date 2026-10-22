import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import request from "supertest";
import { holdJob, projectWithSource, readyProject } from "../../shared/apiTestHelpers";
import { FakeRenderer } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe("still frames", () => {
  it("renders a png at t", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const res = await request(a).get(`/api/projects/${project.id}/frame?t=4000`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((res.body as Buffer).subarray(0, 4)).toEqual(PNG_MAGIC);
    expect((deps.renderer as FakeRenderer).stillCalls.at(-1)).toMatchObject({ timestampMs: 4000, width: 540, compositionId: "CaptionVideo" });
  });

  it("leaves no frame files or folders behind on the data disk", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    await Promise.all([1000, 1000, 2000].map((t) => request(a).get(`/api/projects/${project.id}/frame?t=${t}`).expect(200)));
    expect(readdirSync(dirname(deps.storage.workPath("frames/probe")))).toEqual([]); // no per-project folder either (1 MiB each on ExFAT)
  });

  it("frame clamps t to the output duration", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const late = await request(a).get(`/api/projects/${project.id}/frame?t=999999&w=5000`);
    expect(late.headers["x-sabi-frame-ms"]).toBe("21000");
    expect((deps.renderer as FakeRenderer).stillCalls.at(-1)).toMatchObject({ timestampMs: 21000, width: 1080 });
    const early = await request(a).get(`/api/projects/${project.id}/frame?t=-5&w=10`);
    expect(early.headers["x-sabi-frame-ms"]).toBe("0");
    expect((deps.renderer as FakeRenderer).stillCalls.at(-1)).toMatchObject({ timestampMs: 0, width: 160 });
  });

  it("frame while busy is 409", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const release = await holdJob(deps, project.id, { kind: "captions", progress: 40, stage: "render" });
    await vi.waitFor(async () => expect((await deps.jobs.active(project.id))?.progress).toBe(40));
    const res = await request(a).get(`/api/projects/${project.id}/frame?t=0`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "busy", job: { kind: "captions", progress: 40, stage: "render" } });
    expect((deps.renderer as FakeRenderer).stillCalls).toHaveLength(0);
    release();
  });

  it("frame before captions is 400", async () => {
    const deps = makeTestDeps();
    const { a, project } = await projectWithSource(deps);
    const res = await request(a).get(`/api/projects/${project.id}/frame?t=0`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "no_captions" });
    expect((await request(a).get("/api/projects/nope/frame")).status).toBe(404);
  });

  it("job endpoint returns the active job, else the last finished one, else null", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const fresh = await projectWithSource(deps);
    const idle = await request(a).get(`/api/projects/${fresh.project.id}/job`);
    expect(idle.status).toBe(200);
    expect(idle.body).toBeNull();
    expect((await request(a).get(`/api/projects/${project.id}/job`)).body).toMatchObject({ kind: "captions", state: "COMPLETE" });
    const release = await holdJob(deps, project.id, { kind: "plan" });
    const job = (await deps.jobs.active(project.id))!;
    expect((await request(a).get(`/api/projects/${project.id}/job`)).body).toMatchObject({ id: job.id, kind: "plan", state: "PROCESSING" });
    release();
    await vi.waitFor(async () => expect((await request(a).get(`/api/projects/${project.id}/job`)).body).toMatchObject({ id: job.id, state: "COMPLETE" }));
  });
});
