import { randomUUID } from "node:crypto";
import type { JobState } from "../../shared/types";
import type { EventBus } from "./events";

export type JobFn = (ctx: { report(progress: number, stage?: string): void }) => Promise<void>;

export interface JobRunner {
  enqueue(projectId: string, kind: string, run: JobFn): JobState;
  active(projectId: string): JobState | null;
  last(projectId: string): JobState | null; // most recent finished job (COMPLETE/FAILED), so pollers learn the outcome
}

// In-process runner: one job at a time per project, FIFO. BullMQ replaces it in plan 5.
export class MemoryJobRunner implements JobRunner {
  private queues = new Map<string, { job: JobState; run: JobFn }[]>();
  private running = new Map<string, JobState>();
  private finished = new Map<string, JobState>();

  constructor(private bus: EventBus) {}

  enqueue(projectId: string, kind: string, run: JobFn): JobState {
    const job: JobState = { id: randomUUID(), projectId, kind, state: "QUEUED", progress: 0 };
    const q = this.queues.get(projectId) ?? [];
    q.push({ job, run });
    this.queues.set(projectId, q);
    this.bus.publish(projectId, { type: "job", job: { ...job } });
    if (!this.running.has(projectId)) void this.drain(projectId);
    return { ...job };
  }

  active(projectId: string) {
    const j = this.running.get(projectId);
    return j ? { ...j } : null;
  }

  last(projectId: string) {
    const j = this.finished.get(projectId);
    return j ? { ...j } : null;
  }

  private async drain(projectId: string) {
    const q = this.queues.get(projectId);
    const next = q?.shift();
    if (!next) { this.running.delete(projectId); return; }
    const { job, run } = next;
    this.running.set(projectId, job);
    const emit = () => this.bus.publish(projectId, { type: "job", job: { ...job } });
    job.state = "PROCESSING"; emit();
    try {
      await run({ report: (progress, stage) => { job.progress = progress; if (stage) job.stage = stage; emit(); } });
      job.state = "COMPLETE"; job.progress = 100;
    } catch (err) {
      job.state = "FAILED"; job.error = err instanceof Error ? err.message : String(err);
    }
    this.running.delete(projectId);
    this.finished.set(projectId, job);
    emit();
    void this.drain(projectId);
  }
}
