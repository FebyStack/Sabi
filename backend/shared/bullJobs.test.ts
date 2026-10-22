import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { BullJobRunner } from "./bullJobs";
import { MemoryEventBus } from "./events";
import { runnerContract } from "./jobRunnerContract";

// Real Redis from `make db`; opt in with REDIS_TEST_URL (npm run test:infra). Each case gets its own queue.
const url = process.env.REDIS_TEST_URL;
const queue = () => `sabi-test-${randomUUID().slice(0, 8)}`;

describe.skipIf(!url)("BullJobRunner", { timeout: 30_000 }, () => {
  runnerContract(async (bus) => {
    const r = new BullJobRunner(url!, bus, { queue: queue() });
    await r.start();
    return r;
  });

  it("a job interrupted by a dead worker comes back as attempt 2", async () => {
    const name = queue();
    const data = { input: {}, actor: "web" as const, prevStatus: "ready" as const };
    const a = new BullJobRunner(url!, new MemoryEventBus(), { queue: name, lockMs: 1000 });
    const attempts: number[] = [];
    let started!: () => void;
    const running = new Promise<void>((r) => { started = r; });
    a.handle("slow", async ({ attempt }) => { attempts.push(attempt); started(); await new Promise(() => {}); }); // never finishes: the API dies mid-job
    await a.start();
    await a.enqueue("p1", "slow", data);
    await running;
    await a.close({ force: true }); // the process is gone; its lock expires
    const b = new BullJobRunner(url!, new MemoryEventBus(), { queue: name, lockMs: 1000 });
    b.handle("slow", async ({ attempt }) => { attempts.push(attempt); return { assetIds: [] }; });
    await b.start();
    await vi.waitFor(async () => expect((await b.last("p1"))?.state).toBe("COMPLETE"), { timeout: 15_000 });
    expect(attempts).toEqual([1, 2]);
    await b.close();
  });

  it("forget removes the project's finished jobs", async () => {
    const r = new BullJobRunner(url!, new MemoryEventBus(), { queue: queue() });
    r.handle("ok", async () => {});
    await r.start();
    const job = await r.enqueue("p1", "ok", { input: { prompt: "a private prompt" }, actor: "agent", prevStatus: "ready" });
    await vi.waitFor(async () => expect((await r.get("p1", job.id))?.state).toBe("COMPLETE"));
    await r.forget("p1");
    expect(await r.get("p1", job.id)).toBeNull(); // job data (prompts) is gone from Redis
    await r.close();
  });

  it("forget rewrites Redis's append-only log, so a deleted project's prompts leave the disk", async () => {
    const admin = new Redis(url!);
    const rewrites = async () => Number((await admin.info("persistence")).match(/aof_rewrites:(\d+)/)?.[1] ?? 0);
    const r = new BullJobRunner(url!, new MemoryEventBus(), { queue: queue() });
    r.handle("ok", async () => {});
    await r.start();
    const job = await r.enqueue("p2", "ok", { input: { prompt: "a private prompt" }, actor: "agent", prevStatus: "ready" });
    await vi.waitFor(async () => expect((await r.get("p2", job.id))?.state).toBe("COMPLETE"));
    await vi.waitFor(async () => expect((await admin.info("persistence")).includes("aof_rewrite_in_progress:0")).toBe(true));
    const before = await rewrites();
    await r.forget("p2");
    await vi.waitFor(async () => expect(await rewrites()).toBeGreaterThan(before), { timeout: 10_000 }); // the log no longer holds the old write
    await r.forget("nobody"); // nothing removed: no rewrite needed
    await r.close();
    admin.disconnect();
  });
});

