import { randomUUID } from "node:crypto";
import type { Actor, JobResult, JobState, ProjectStatus } from "../../shared/types";
import type { EventBus } from "./events";

// A job is data (kind + this), so a queue can hold it across restarts; its handler loads the project when it starts.
export type JobData = { input: unknown; actor: Actor; prevStatus: ProjectStatus };
export type JobContext = { projectId: string; jobId: string; data: JobData; attempt: number; report(progress: number, stage?: string): void };
export type JobHandler = (ctx: JobContext) => Promise<JobResult | void>;

export class JobBusy extends Error {
  constructor(readonly job: JobState) { super("busy"); }
}

export interface JobRunner {
  handle(kind: string, handler: JobHandler): void; // registering a kind again replaces its handler
  enqueue(projectId: string, kind: string, data: JobData): Promise<JobState>; // JobBusy when the project already has a queued or running job
  active(projectId: string): Promise<JobState | null>; // queued or running
  last(projectId: string): Promise<JobState | null>; // most recent finished job (COMPLETE/FAILED), so pollers learn the outcome
  get(projectId: string, jobId: string): Promise<JobState | null>;
  forget(projectId: string): Promise<void>; // drop the project's finished jobs (their data holds prompts)
  start?(): Promise<void>; // queues that need it begin consuming once handlers are registered
}

const KEEP_FINISHED = 20;

// In-process runner: one global FIFO, one job at a time across the machine (a render saturates it anyway).
export class MemoryJobRunner implements JobRunner {
  private handlers = new Map<string, JobHandler>();
  private queue: { job: JobState; data: JobData }[] = [];
  private running: JobState | null = null;
  private finished = new Map<string, JobState[]>(); // per project, oldest first
  private draining = false;

  constructor(private bus: EventBus) {}

  handle(kind: string, handler: JobHandler) { this.handlers.set(kind, handler); }

  async enqueue(projectId: string, kind: string, data: JobData): Promise<JobState> {
    const busy = this.activeNow(projectId);
    if (busy) throw new JobBusy(busy);
    const job: JobState = { id: randomUUID(), projectId, kind, state: "QUEUED", progress: 0 };
    this.queue.push({ job, data });
    this.emit(job);
    if (!this.draining) void this.drain();
    return { ...job };
  }

  async active(projectId: string) { return this.activeNow(projectId); }

  async last(projectId: string) {
    const j = this.finished.get(projectId)?.at(-1);
    return j ? { ...j } : null;
  }

  async get(projectId: string, jobId: string) {
    const j = [this.running, ...this.queue.map((q) => q.job), ...(this.finished.get(projectId) ?? [])].find((x) => x?.id === jobId);
    return j && j.projectId === projectId ? { ...j } : null;
  }

  async forget(projectId: string) { this.finished.delete(projectId); }

  private activeNow(projectId: string): JobState | null {
    const j = this.running?.projectId === projectId ? this.running : this.queue.find((q) => q.job.projectId === projectId)?.job;
    return j ? { ...j } : null;
  }

  private emit(job: JobState) { this.bus.publish(job.projectId, { type: "job", job: { ...job } }); }

  private async drain() {
    this.draining = true;
    for (let next = this.queue.shift(); next; next = this.queue.shift()) {
      const { job, data } = next;
      this.running = job;
      job.state = "PROCESSING"; this.emit(job);
      try {
        const handler = this.handlers.get(job.kind);
        if (!handler) throw new Error("no_handler");
        const report = (progress: number, stage?: string) => { job.progress = progress; if (stage) job.stage = stage; this.emit(job); };
        const result = await handler({ projectId: job.projectId, jobId: job.id, data, attempt: 1, report });
        job.state = "COMPLETE"; job.progress = 100;
        if (result) job.result = result;
      } catch (err) {
        job.state = "FAILED"; job.error = err instanceof Error ? err.message : String(err);
      }
      this.running = null;
      this.finished.set(job.projectId, [...(this.finished.get(job.projectId) ?? []), job].slice(-KEEP_FINISHED));
      this.emit(job);
    }
    this.draining = false;
  }
}
