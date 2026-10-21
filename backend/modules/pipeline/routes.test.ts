import request from "supertest";
import { readyProject, untilStatus } from "../../shared/apiTestHelpers";
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
    expect((await request(a).post(`/api/projects/${project.id}/render`).send({ scale: 3 })).body.error).toBe("invalid_input");
  });

  it("the retired routes are 404", async () => {
    const { a, project } = await readyProject(makeTestDeps());
    expect((await request(a).put(`/api/projects/${project.id}/phrases`).send({ phrases: project.phrases })).status).toBe(404);
    expect((await request(a).put(`/api/projects/${project.id}/template`).send({ captionTemplateId: "bold" })).status).toBe(404);
    expect((await request(a).patch(`/api/projects/${project.id}/plan`).send({ cuts: [] })).status).toBe(404);
    expect((await request(a).patch(`/api/projects/${project.id}`).send({ mediaSource: "stock" })).status).toBe(404);
  });
});
