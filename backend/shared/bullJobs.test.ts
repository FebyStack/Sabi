import { randomUUID } from "node:crypto";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { Redis } from "ioredis";
import { BullJobRunner } from "./bullJobs";
import { MemoryEventBus } from "./events";
import { runnerContract } from "./jobRunnerContract";

// Real Redis from `make db`; opt in with REDIS_TEST_URL (npm run test:infra). Each case gets its own queue.
const url = process.env.REDIS_TEST_URL;
const queue = () => `sabi-test-${randomUUID().slice(0, 8)}`;
const data = { input: {}, actor: "web" as const, prevStatus: "ready" as const };

// Redis behind a TCP proxy: down() cuts every connection and refuses new ones, as a stopped Redis does; up() lets them back.
async function cuttableRedis(target: string) {
  const { hostname, port } = new URL(target);
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(Number(port), hostname);
    for (const s of [client, upstream]) { sockets.add(s); s.on("error", () => {}); s.on("close", () => sockets.delete(s)); }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const local = (server.address() as AddressInfo).port;
  return {
    url: `redis://127.0.0.1:${local}`,
    down: () => new Promise<void>((r) => { server.close(() => r()); for (const s of sockets) s.destroy(); }),
    up: () => new Promise<void>((r) => server.listen(local, "127.0.0.1", r)),
  };
}

describe.skipIf(!url)("BullJobRunner", { timeout: 30_000 }, () => {
  runnerContract(async (bus) => {
    const r = new BullJobRunner(url!, bus, { queue: queue() });
    await r.start();
    return r;
  });

  it("a job interrupted by a dead worker comes back as attempt 2", async () => {
    const name = queue();
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

  it("a job that dies twice is failed by BullMQ without its handler; onAbandoned hears of it (a handler's own failure it doesn't)", async () => {
    const name = queue();
    const dying = async () => { // a worker whose API dies mid-job
      const r = new BullJobRunner(url!, new MemoryEventBus(), { queue: name, lockMs: 1000 });
      const running = new Promise<void>((started) => r.handle("slow", async () => { started(); await new Promise(() => {}); }));
      await r.start();
      return { r, running };
    };
    const a = await dying();
    await a.r.enqueue("p1", "slow", data);
    await a.running;
    await a.r.close({ force: true });
    const b = await dying(); // attempt 2 dies too
    await b.running;
    await b.r.close({ force: true });
    const c = new BullJobRunner(url!, new MemoryEventBus(), { queue: name, lockMs: 1000 });
    const ran: number[] = [];
    const abandoned: [string, string][] = [];
    c.handle("slow", async ({ attempt }) => { ran.push(attempt); });
    c.handle("boom", async () => { throw new Error("boom"); });
    c.onAbandoned(async (projectId, d) => { abandoned.push([projectId, d.prevStatus]); });
    await c.start();
    await vi.waitFor(async () => expect(await c.last("p1")).toMatchObject({ state: "FAILED", error: "job stalled more than allowable limit" }), { timeout: 20_000 });
    expect(ran).toEqual([]); // no handler ran, so nothing put the project back
    await vi.waitFor(() => expect(abandoned).toEqual([["p1", "ready"]]));
    await c.enqueue("p2", "boom", data);
    await vi.waitFor(async () => expect((await c.last("p2"))?.state).toBe("FAILED"));
    expect(abandoned).toEqual([["p1", "ready"]]); // a handler that throws cleans up after itself
    await c.close();
  });

  it("while Redis is down, queue reads fail within seconds instead of hanging; they work again once it is back", async () => {
    const redis = await cuttableRedis(url!);
    const r = new BullJobRunner(redis.url, new MemoryEventBus(), { queue: queue() });
    await r.start();
    expect(await r.active("p1")).toBeNull();
    await redis.down();
    const t0 = Date.now();
    await expect(r.active("p1")).rejects.toThrow(); // an API request answers 500 instead of waiting forever
    expect(Date.now() - t0).toBeLessThan(10_000);
    await redis.up();
    await vi.waitFor(async () => expect(await r.active("p1")).toBeNull(), { timeout: 15_000 });
    await r.close();
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

