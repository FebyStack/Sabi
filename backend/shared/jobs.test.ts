import { MemoryEventBus } from "./events";
import { MemoryJobRunner } from "./jobs";
import type { JobState } from "../../shared/types";

const collect = (bus: MemoryEventBus, projectId: string) => {
  const seen: JobState[] = [];
  bus.subscribe(projectId, (e) => { if (e.type === "job") seen.push(e.job); });
  return seen;
};

describe("MemoryJobRunner", () => {
  it("runs jobs per project in order and reports progress", async () => {
    const bus = new MemoryEventBus();
    const runner = new MemoryJobRunner(bus);
    const seen = collect(bus, "p1");
    const order: string[] = [];
    runner.enqueue("p1", "a", async ({ report }) => { report(50, "half"); order.push("a"); });
    runner.enqueue("p1", "b", async () => { order.push("b"); });
    await vi.waitFor(() => expect(order).toEqual(["a", "b"]));
    expect(seen.map((j) => [j.kind, j.state, j.progress])).toContainEqual(["a", "PROCESSING", 50]);
    expect(seen.find((j) => j.kind === "a" && j.progress === 50)?.stage).toBe("half");
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: "b", state: "COMPLETE", progress: 100 }));
    expect(runner.active("p1")).toBeNull();
  });

  it("marks a throwing job FAILED with its message", async () => {
    const bus = new MemoryEventBus();
    const runner = new MemoryJobRunner(bus);
    const seen = collect(bus, "p1");
    runner.enqueue("p1", "boom", async () => { throw new Error("boom"); });
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ state: "FAILED", error: "boom" }));
    expect(runner.active("p1")).toBeNull();
  });

  it("exposes the active job while it runs", async () => {
    const bus = new MemoryEventBus();
    const runner = new MemoryJobRunner(bus);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const job = runner.enqueue("p1", "slow", async () => { await gate; });
    await vi.waitFor(() => expect(runner.active("p1")?.state).toBe("PROCESSING"));
    expect(runner.active("p1")?.id).toBe(job.id);
    release();
    await vi.waitFor(() => expect(runner.active("p1")).toBeNull());
  });
});
