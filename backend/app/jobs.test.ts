import { readyProject } from "../shared/apiTestHelpers";
import { FakeGenerator } from "../shared/generator";
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

  it("a first attempt runs normally", async () => {
    const deps = makeTestDeps();
    const { project } = await readyProject(deps);
    await expect(noRerun(deps, generateJob(deps))(ctx(project.id, 1))).resolves.toMatchObject({ assetIds: [expect.any(String)] });
    expect((deps.generator as FakeGenerator).calls).toHaveLength(1);
  });
});
