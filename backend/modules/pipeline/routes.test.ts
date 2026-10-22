import request from "supertest";
import { holdJob, readyProject, untilStatus } from "../../shared/apiTestHelpers";
import { FakeRenderer } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";

describe("pipeline routes", () => {
  it("render at scale 2 doubles the output size", async () => {
    const deps = makeTestDeps();
    const renderer = deps.renderer as FakeRenderer;
    const { a, project } = await readyProject(deps);
    expect(renderer.calls.at(-1)!.scale).toBe(1);
    expect((await request(a).post(`/api/projects/${project.id}/render`).send({ scale: 2 })).status).toBe(202);
    const done = await untilStatus(a, project.id, "ready");
    expect(renderer.calls.at(-1)!.scale).toBe(2);
    expect(done.outputs.resolution).toBe("4k");
    expect(await deps.assets.get(done.outputs.mp4AssetId!)).toMatchObject({ width: 2160, height: 3840 });
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    await vi.waitFor(() => expect(renderer.calls.length).toBeGreaterThan(2));
    expect((await untilStatus(a, project.id, "ready")).outputs.resolution).toBe("4k");
    expect(renderer.calls.at(-1)!.scale).toBe(2); // other jobs keep the project's resolution
    await request(a).post(`/api/projects/${project.id}/render`).send({}); // no scale (MCP run_job render): keep the last export's 4K
    await vi.waitFor(() => expect(renderer.calls.length).toBeGreaterThan(3));
    expect((await untilStatus(a, project.id, "ready")).outputs.resolution).toBe("4k");
    expect(renderer.calls.at(-1)!.scale).toBe(2);
    await request(a).post(`/api/projects/${project.id}/render`).send({ scale: 1 });
    await vi.waitFor(() => expect(renderer.calls.length).toBeGreaterThan(4));
    expect((await untilStatus(a, project.id, "ready")).outputs.resolution).toBe("1080p");
    expect((await request(a).post(`/api/projects/${project.id}/render`).send({ scale: 3 })).body.error).toBe("invalid_input");
  });

  it("the retired routes are 404", async () => {
    const { a, project } = await readyProject(makeTestDeps());
    expect((await request(a).put(`/api/projects/${project.id}/phrases`).send({ phrases: project.phrases })).status).toBe(404);
    expect((await request(a).put(`/api/projects/${project.id}/template`).send({ captionTemplateId: "bold" })).status).toBe(404);
    expect((await request(a).patch(`/api/projects/${project.id}/plan`).send({ cuts: [] })).status).toBe(404);
    expect((await request(a).patch(`/api/projects/${project.id}`).send({ mediaSource: "stock" })).status).toBe(404);
  });

  it("two quick renders: the second gets 409 busy", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const [one, two] = await Promise.all([1, 2].map(() => request(a).post(`/api/projects/${project.id}/render`).send({})));
    expect([one.status, two.status].sort()).toEqual([202, 409]);
    expect([one.body, two.body].find((b) => b.error)).toMatchObject({ error: "busy", job: { kind: "captions" } });
    await untilStatus(a, project.id, "ready");
  });

  it("a job whose project was deleted while queued fails not_found", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const release = await holdJob(deps, "someone-else"); // the machine is busy with another project's job
    const { body } = await request(a).post(`/api/projects/${project.id}/render`).send({});
    expect((await deps.jobs.active(project.id))?.state).toBe("QUEUED");
    await deps.projects.remove(project.id);
    release();
    await vi.waitFor(async () => expect(await deps.jobs.get(project.id, body.jobId)).toMatchObject({ state: "FAILED", error: "not_found" }));
  });
});

