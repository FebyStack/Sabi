import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAssetRepository } from "../modules/assets/repository";
import { MemoryProjectRepository } from "../modules/projects/repository";
import type { AppDeps } from "./deps";
import { MemoryEventBus } from "./events";
import { MemoryJobRunner } from "./jobs";
import { FakeMedia, FfmpegMedia } from "./media";
import { FsStorage } from "./storage";
import { FakeTranscriber, WhisperXTranscriber } from "./transcriber";
import sampleTranscript from "./fixtures/transcript-sample.json";

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  let n = 0;
  const bus = new MemoryEventBus();
  return {
    projects: new MemoryProjectRepository(),
    assets: new MemoryAssetRepository(),
    storage: new FsStorage(mkdtempSync(join(tmpdir(), "cc-"))),
    media: new FakeMedia({ durationMs: 21000, width: 1080, height: 1920 }),
    bus,
    jobs: new MemoryJobRunner(bus),
    transcriber: new FakeTranscriber(sampleTranscript),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    id: () => `id-${++n}`,
    ...overrides,
  };
}

export function makeMemoryDeps(dataDir: string): AppDeps {
  const bus = new MemoryEventBus();
  return {
    projects: new MemoryProjectRepository(),
    assets: new MemoryAssetRepository(),
    storage: new FsStorage(dataDir),
    media: new FfmpegMedia(),
    bus,
    jobs: new MemoryJobRunner(bus),
    transcriber: new WhisperXTranscriber(process.env.WHISPERX_URL ?? "http://localhost:8010"),
    now: () => new Date(),
    id: randomUUID,
  };
}
