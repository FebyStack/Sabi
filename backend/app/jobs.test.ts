import { readyProject } from "../shared/apiTestHelpers";
import { MemoryEventBus } from "../shared/events";
import { FakeGenerator } from "../shared/generator";
import { MemoryJobRunner, type JobData } from "../shared/jobs";
import { makeTestDeps } from "../shared/testing";
import { generateJob } from "../modules/generate/job";
import { noRerun } from "./jobs";

const ctx = (projectId: string, attempt: number) => ({
  projectId, jobId: "j", attempt, report: () => {},
  data: { input: { source: "generate", media: "image", prompt: "a kettle" }, actor: "agent" as const, prevStatus: "ready" as const },
});

describe("noRerun", () => {
  it("an interrupted generate job fails without calling fal again", async () => {
    const deps = makeTestDeps();
    const { project } = await readyProject(deps);
    await deps.projects.update(project.id, { status: "generating" }); // where the dead process left it
    await expect(noRerun(deps, generateJob(deps))(ctx(project.id, 2))).rejects.toThrow("interrupted");
    expect((deps.generator as FakeGenerator).calls).toEqual([]);
    expect(await deps.ledger.since(new Date(0))).toEqual([]);
    const after = (await deps.projects.get(project.id))!;
    expect(after.status).toBe("ready"); // back to what it was before the job
    expect(after.outputs.stale).toBe(true); // the job may have changed what the MP4 shows
  });

  it("a second start after the first attempt finished (BullMQ lost its lock) leaves the project alone and doesn't say interrupted", async () => {
    const deps = makeTestDeps();
    const { project } = await readyProject(deps); // not running: attempt 1 already put it back
    await expect(noRerun(deps, generateJob(deps))(ctx(project.id, 2))).rejects.toThrow("already_ran"); // "run it again" would charge twice
    expect((deps.generator as FakeGenerator).calls).toEqual([]);
    const after = (await deps.projects.get(project.id))!;
    expect([after.status, after.outputs.stale, after.updatedAt]).toEqual(["ready", undefined, project.updatedAt]);
  });

  it("a first attempt runs normally", async () => {
    const deps = makeTestDeps();
    const { project } = await readyProject(deps);
    await expect(noRerun(deps, generateJob(deps))(ctx(project.id, 1))).resolves.toMatchObject({ assetIds: [expect.any(String)] });
    expect((deps.generator as FakeGenerator).calls).toHaveLength(1);
  });
});

describe("abandoned jobs", () => {
  class AbandoningRunner extends MemoryJobRunner {
    abandon?: (projectId: string, data: JobData) => Promise<void>;
    onAbandoned(fn: (projectId: string, data: JobData) => Promise<void>) { this.abandon = fn; }
  }

  it("a job the queue failed without its handler (it stalled twice) puts the project back as it was, MP4 stale", async () => {
    const bus = new MemoryEventBus();
    const jobs = new AbandoningRunner(bus);
    const deps = makeTestDeps({ bus, jobs });
    const { project } = await readyProject(deps); // createApp registers the handlers and the hook
    await deps.projects.update(project.id, { status: "rendering" }); // where the second dead attempt left it
    await jobs.abandon!(project.id, { input: {}, actor: "web", prevStatus: "ready" });
    const after = (await deps.projects.get(project.id))!;
    expect([after.status, after.outputs.stale]).toEqual(["ready", true]);
  });
});
