import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAssetRepository } from "../modules/assets/repository";
import { MemoryProjectRepository } from "../modules/projects/repository";
import type { AppDeps } from "./deps";
import { FakeMedia, FfmpegMedia } from "./media";
import { FsStorage } from "./storage";

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  let n = 0;
  return {
    projects: new MemoryProjectRepository(),
    assets: new MemoryAssetRepository(),
    storage: new FsStorage(mkdtempSync(join(tmpdir(), "cc-"))),
    media: new FakeMedia({ durationMs: 21000, width: 1080, height: 1920 }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    id: () => `id-${++n}`,
    ...overrides,
  };
}

export function makeMemoryDeps(dataDir: string): AppDeps {
  return {
    projects: new MemoryProjectRepository(),
    assets: new MemoryAssetRepository(),
    storage: new FsStorage(dataDir),
    media: new FfmpegMedia(),
    now: () => new Date(),
    id: randomUUID,
  };
}
