import request from "supertest";
import { readyProject } from "../../shared/apiTestHelpers";
import { makeTestDeps } from "../../shared/testing";
import { MemoryProjectRepository } from "../projects/repository";
import { sweepRetention } from "./sweep";

const DAY = 86_400_000;

describe("retention sweep", () => {
  it("sweep removes only stale projects and their files", async () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const deps = makeTestDeps({ projects: new MemoryProjectRepository(() => clock) });
    const { project: old } = await readyProject(deps);
    const oldFiles = await deps.assets.listByProject(old.id);
    clock = new Date(clock.getTime() + 30 * DAY); // opened yesterday, from the sweep's point of view
    const { a, project: fresh } = await readyProject(deps);
    clock = new Date(clock.getTime() + DAY);
    expect(await sweepRetention(deps, new Date(clock.getTime() - 30 * DAY))).toEqual([old.id]);
    expect((await request(a).get(`/api/projects/${old.id}`)).status).toBe(404);
    for (const f of oldFiles) expect(await deps.storage.stat(f.key)).toBeNull();
    expect((await request(a).get(`/api/projects/${fresh.id}`)).status).toBe(200);
    expect((await deps.assets.listByProject(fresh.id)).length).toBeGreaterThan(0);
  });

  it("a project with a running job is skipped", async () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const deps = makeTestDeps({ projects: new MemoryProjectRepository(() => clock) });
    const { project } = await readyProject(deps);
    let release!: () => void;
    deps.jobs.enqueue(project.id, "render", () => new Promise<void>((r) => { release = r; }));
    await vi.waitFor(() => expect(deps.jobs.active(project.id)).not.toBeNull());
    clock = new Date(clock.getTime() + 40 * DAY);
    expect(await sweepRetention(deps, new Date(clock.getTime() - 30 * DAY))).toEqual([]);
    expect(await deps.projects.list()).toHaveLength(1);
    release();
  });
});
