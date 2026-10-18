import type { ProjectEvent } from "../../shared/types";

export interface EventBus {
  publish(projectId: string, event: ProjectEvent): void;
  subscribe(projectId: string, fn: (e: ProjectEvent) => void): () => void;
}

export class MemoryEventBus implements EventBus {
  private subs = new Map<string, Set<(e: ProjectEvent) => void>>();
  publish(projectId: string, event: ProjectEvent) {
    this.subs.get(projectId)?.forEach((fn) => fn(event));
  }
  subscribe(projectId: string, fn: (e: ProjectEvent) => void) {
    const set = this.subs.get(projectId) ?? new Set();
    set.add(fn);
    this.subs.set(projectId, set);
    return () => { set.delete(fn); };
  }
}
