import request from "supertest";
import { readyProject } from "../../shared/apiTestHelpers";
import { makeTestDeps } from "../../shared/testing";

describe("project delete", () => {
  it("delete removes rows and files", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const assets = await deps.assets.listByProject(project.id);
    expect(assets.length).toBeGreaterThan(3); // source, mp4, srt, vtt
    for (const x of assets) expect(await deps.storage.stat(x.key)).not.toBeNull();
    expect((await request(a).delete(`/api/projects/${project.id}`)).status).toBe(204);
    for (const x of assets) {
      expect(await deps.storage.stat(x.key)).toBeNull();
      expect(await deps.assets.get(x.id)).toBeNull();
    }
    expect(await deps.storage.stat(`work/${project.id}/audio.wav`)).toBeNull();
    expect((await request(a).get(`/api/projects/${project.id}`)).status).toBe(404);
    expect((await request(a).delete(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it("delete refuses a busy project", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    let release!: () => void;
    deps.jobs.enqueue(project.id, "plan", () => new Promise<void>((r) => { release = r; }));
    await vi.waitFor(() => expect(deps.jobs.active(project.id)).not.toBeNull());
    const res = await request(a).delete(`/api/projects/${project.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("busy");
    expect((await request(a).get(`/api/projects/${project.id}`)).status).toBe(200);
    release();
  });
});
