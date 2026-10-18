import { randomUUID } from "node:crypto";
import { MemoryProjectRepository } from "../modules/projects/repository";
import type { AppDeps } from "./deps";

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  let n = 0;
  return {
    projects: new MemoryProjectRepository(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    id: () => `id-${++n}`,
    ...overrides,
  };
}

export function makeMemoryDeps(): AppDeps {
  return { projects: new MemoryProjectRepository(), now: () => new Date(), id: randomUUID };
}
