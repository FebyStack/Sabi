import { MemoryEventBus } from "./events";
import { JobBusy, MemoryJobRunner, type JobData } from "./jobs";
import type { JobState } from "../../shared/types";

const data: JobData = { input: {}, actor: "web", prevStatus: "ready" };
const collect = (bus: MemoryEventBus, projectId: string) => {
  const seen: JobState[] = [];
  bus.subscribe(projectId, (e) => { if (e.type === "job") seen.push(e.job); });
  return seen;
};
const gated = () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { gate, release };
};

describe("MemoryJobRunner", () => {
  it("runs one job at a time across projects, in order", async () => {
    const runner = new MemoryJobRunner(new MemoryEventBus());
    const order: string[] = [];
    const a = gated();
    runner.handle("a", async () => { await a.gate; order.push("a"); });
    runner.handle("b", async () => { order.push("b"); });
    await runner.enqueue("p1", "a", data);
    await runner.enqueue("p2", "b", data);
    await vi.waitFor(async () => expect((await runner.active("p1"))?.state).toBe("PROCESSING"));
    expect((await runner.active("p2"))?.state).toBe("QUEUED"); // another project's job waits its turn
    a.release();
    await vi.waitFor(() => expect(order).toEqual(["a", "b"]));
    await vi.waitFor(async () => expect(await runner.active("p2")).toBeNull());
  });

  it("reports progress, result and failure", async () => {
    const bus = new MemoryEventBus();
    const runner = new MemoryJobRunner(bus);
    const seen = collect(bus, "p1");
    runner.handle("ok", async ({ report }) => { report(50, "half"); return { assetIds: ["x"] }; });
    runner.handle("boom", async () => { throw new Error("boom"); });
    await runner.enqueue("p1", "ok", data);
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: "ok", state: "COMPLETE", progress: 100, result: { assetIds: ["x"] } }));
    expect(seen).toContainEqual(expect.objectContaining({ kind: "ok", state: "PROCESSING", progress: 50, stage: "half" }));
    await runner.enqueue("p1", "boom", data);
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: "boom", state: "FAILED", error: "boom" }));
    expect(await runner.last("p1")).toMatchObject({ kind: "boom", state: "FAILED", error: "boom" }); // pollers still learn why
    expect(await runner.last("p2")).toBeNull();
  });

  it("refuses a second job for a busy project", async () => {
    const runner = new MemoryJobRunner(new MemoryEventBus());
    const a = gated();
    runner.handle("a", () => a.gate);
    const first = await runner.enqueue("p1", "a", data);
    const second = runner.enqueue("p1", "a", data);
    await expect(second).rejects.toBeInstanceOf(JobBusy);
    await expect(second).rejects.toMatchObject({ job: { id: first.id } });
    a.release();
  });

  it("get finds a finished job by id and forget drops it", async () => {
    const runner = new MemoryJobRunner(new MemoryEventBus());
    runner.handle("ok", async () => {});
    const job = await runner.enqueue("p1", "ok", data);
    await vi.waitFor(async () => expect(await runner.get("p1", job.id)).toMatchObject({ state: "COMPLETE" }));
    expect(await runner.get("p2", job.id)).toBeNull(); // a job id never answers for another project
    await runner.forget("p1");
    expect(await runner.get("p1", job.id)).toBeNull();
    expect(await runner.last("p1")).toBeNull();
  });

  it("an unknown kind fails with no_handler", async () => {
    const runner = new MemoryJobRunner(new MemoryEventBus());
    const job = await runner.enqueue("p1", "nope", data);
    await vi.waitFor(async () => expect(await runner.get("p1", job.id)).toMatchObject({ state: "FAILED", error: "no_handler" }));
  });
});
