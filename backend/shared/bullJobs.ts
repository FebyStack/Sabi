import { randomUUID } from "node:crypto";
import { Job, Queue, UnrecoverableError, Worker } from "bullmq";
import type { JobResult, JobState } from "../../shared/types";
import type { EventBus } from "./events";
import { JobBusy, type JobData, type JobHandler, type JobRunner } from "./jobs";

type Data = JobData & { projectId: string };
type Progress = { progress: number; stage?: string };
const KEEP = { age: 7 * 86_400, count: 200 }; // finished jobs hold prompts: a week at most (and deleted with their project)
const SCAN = 200;

const toState = (job: Job<Data>, state: JobState["state"]): JobState => {
  const p = (job.progress && typeof job.progress === "object" ? job.progress : { progress: 0 }) as Progress;
  return {
    id: job.id!, projectId: job.data.projectId, kind: job.name, state, progress: state === "COMPLETE" ? 100 : p.progress,
    ...(p.stage ? { stage: p.stage } : {}), ...(state === "FAILED" ? { error: job.failedReason } : {}),
    ...(state === "COMPLETE" && job.returnvalue ? { result: job.returnvalue as JobResult } : {}),
  };
};
const STATES: Record<string, JobState["state"]> = { waiting: "QUEUED", delayed: "QUEUED", prioritized: "QUEUED", active: "PROCESSING", completed: "COMPLETE", failed: "FAILED" };

// BullMQ on Redis (REDIS_URL): jobs survive an API restart. The worker runs inside the API process, one job at a time,
// so the event bus stays in memory. A job interrupted by a restart comes back through BullMQ's stalled check with attempt 2.
export class BullJobRunner implements JobRunner {
  private queue: Queue<Data>;
  private worker: Worker<Data>;
  private handlers = new Map<string, JobHandler>();
  private adding: Promise<unknown> = Promise.resolve(); // enqueue's busy check and add are one step in this process
  private abandoned = async (_projectId: string, _data: JobData) => {};

  constructor(private url: string, private bus: EventBus, opts: { queue?: string; lockMs?: number } = {}) {
    const name = opts.queue ?? "sabi-jobs";
    // Requests read the queue: while Redis is down they fail in seconds (500) instead of waiting for it. Only the worker's
    // blocking reads must wait out an outage (BullMQ requires maxRetriesPerRequest: null there).
    this.queue = new Queue<Data>(name, { connection: { url, maxRetriesPerRequest: 1 }, defaultJobOptions: { attempts: 1, removeOnComplete: KEEP, removeOnFail: KEEP } });
    this.worker = new Worker<Data>(name, (job) => this.process(job), {
      connection: { url, maxRetriesPerRequest: null }, autorun: false, concurrency: 1, ...(opts.lockMs ? { lockDuration: opts.lockMs, stalledInterval: opts.lockMs } : {}),
    });
    this.worker.on("completed", (job) => this.emit(toState(job, "COMPLETE")));
    this.worker.on("failed", (job, err) => {
      if (!job) return;
      this.emit(toState(job, "FAILED"));
      // A job that stalled twice is failed by BullMQ itself, without its handler: nothing put its project back yet.
      if (err instanceof UnrecoverableError) this.abandoned(job.data.projectId, job.data).catch((e) => console.error("abandoned job cleanup failed", e));
    });
  }

  handle(kind: string, handler: JobHandler) { this.handlers.set(kind, handler); }

  onAbandoned(fn: (projectId: string, data: JobData) => Promise<void>) { this.abandoned = fn; }

  async start() { void this.worker.run(); }

  // force: stop without waiting for the running job (tests stand in for a dead process this way).
  async close({ force = false } = {}) {
    await this.worker.close(force);
    await this.queue.close();
  }

  enqueue(projectId: string, kind: string, data: JobData): Promise<JobState> {
    const run = this.adding.then(async () => {
      const busy = await this.active(projectId);
      if (busy) throw new JobBusy(busy);
      const job = await this.queue.add(kind, { ...data, projectId }, { jobId: randomUUID() });
      const state = toState(job, "QUEUED");
      this.emit(state);
      return state;
    });
    this.adding = run.catch(() => {});
    return run;
  }

  // One read across the lists: a job moving from waiting to active between two reads would be missed.
  async active(projectId: string) {
    const job = (await this.queue.getJobs(["active", "waiting", "prioritized", "delayed"], 0, SCAN - 1)).find((j) => j?.data.projectId === projectId);
    const state = job && STATES[await job.getState()];
    return job && state && state !== "COMPLETE" && state !== "FAILED" ? toState(job, state) : null;
  }

  async last(projectId: string) {
    const done = await Promise.all((["completed", "failed"] as const).map(async (type) =>
      (await this.queue.getJobs([type], 0, SCAN - 1)).filter((j) => j?.data.projectId === projectId).map((j) => ({ j, type }))));
    const latest = done.flat().sort((a, b) => (b.j.finishedOn ?? 0) - (a.j.finishedOn ?? 0))[0];
    return latest ? toState(latest.j, STATES[latest.type]) : null;
  }

  async get(projectId: string, jobId: string) {
    const job = await Job.fromId<Data>(this.queue, jobId);
    if (!job || job.data.projectId !== projectId) return null;
    const state = STATES[await job.getState()];
    return state ? toState(job, state) : null;
  }

  // Deleting a job only appends a delete to Redis's append-only log; the write with the prompt stays on disk until the log is
  // rewritten, so a deleted project's jobs end with a rewrite (BullMQ 6's client wrapper has no raw command: a short connection).
  // A rewrite already running took its snapshot before the delete: ask again until one starts (it normally ends in milliseconds).
  async forget(projectId: string) {
    const done = (await this.queue.getJobs(["completed", "failed"], 0, -1)).filter((j) => j?.data.projectId === projectId);
    if (!done.length) return;
    await Promise.all(done.map((j) => j.remove()));
    const { Redis } = await import("ioredis");
    const admin = new Redis(this.url, { maxRetriesPerRequest: 1 });
    try {
      for (let tries = 0; tries < 300; tries++) { // a minute at most
        const running = await admin.bgrewriteaof().then(() => false, (err) => /already in progress/.test(String(err))); // other errors: best effort
        if (!running) return;
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      admin.disconnect();
    }
  }

  private emit(job: JobState) { this.bus.publish(job.projectId, { type: "job", job }); }

  private async process(job: Job<Data>) {
    const { projectId, input, actor, prevStatus } = job.data;
    this.emit(toState(job, "PROCESSING"));
    const handler = this.handlers.get(job.name);
    if (!handler) throw new Error("no_handler");
    const report = (progress: number, stage?: string) => {
      const p: Progress = { progress, ...(stage ? { stage } : {}) };
      void job.updateProgress(p).catch(() => {});
      this.emit({ ...toState(job, "PROCESSING"), ...p });
    };
    return (await handler({ projectId, jobId: job.id!, data: { input, actor, prevStatus }, attempt: job.attemptsStarted, report })) ?? undefined;
  }
}
