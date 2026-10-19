import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAssetRepository } from "../modules/assets/repository";
import { MemoryProjectRepository } from "../modules/projects/repository";
import type { AppDeps } from "./deps";
import { MemoryEventBus } from "./events";
import { MemoryJobRunner } from "./jobs";
import { FakeLlm, OllamaLlm, type LlmRequest } from "./llm";
import { FakeMedia, FfmpegMedia } from "./media";
import { FakeRenderer, RemotionRenderer } from "./renderer";
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
    renderer: new FakeRenderer(),
    llm: new FakeLlm(fakeLlmResponder),
    apiBaseUrl: "http://test",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    id: () => `id-${++n}`,
    ...overrides,
  };
}

// Deterministic stand-in for Ollama, keyed off the request input: translations prefix each line, plans label every phrase.
export function fakeLlmResponder(req: LlmRequest): unknown {
  const input = JSON.parse(req.user);
  if (input.lines) return { lines: input.lines.map((l: string) => `${input.language}: ${l}`) };
  const phrases: { i: number; text: string }[] = input.phrases;
  const third = phrases.filter((p) => p.i % 3 === 0);
  return {
    shots: third.map((p) => ({ from: p.i, kind: p.i === 0 ? "Hook" : (p.i / 3) % 2 ? "Talking Head" : "B-Roll" })),
    emphasis: phrases.map((p) => ({ phrase: p.i, word: p.text.split(" ")[0], kind: "keyword" })),
    emoji: third.map((p) => ({ phrase: p.i, emoji: "🔥" })),
  };
}

// FAKE_AI=1 swaps whisperX and Ollama for fakes so the UI can be driven without either.
export function makeMemoryDeps(dataDir: string, apiBaseUrl = `http://127.0.0.1:${process.env.PORT ?? 3001}`): AppDeps {
  const bus = new MemoryEventBus();
  const fakeAi = process.env.FAKE_AI === "1";
  return {
    projects: new MemoryProjectRepository(),
    assets: new MemoryAssetRepository(),
    storage: new FsStorage(dataDir),
    media: new FfmpegMedia(),
    bus,
    jobs: new MemoryJobRunner(bus),
    transcriber: fakeAi ? new FakeTranscriber(sampleTranscript) : new WhisperXTranscriber(process.env.WHISPERX_URL ?? "http://localhost:8010"),
    renderer: new RemotionRenderer({ entry: "shared/remotion/index.ts", bundleDir: ".remotion-bundle" }),
    llm: fakeAi ? new FakeLlm(fakeLlmResponder) : new OllamaLlm(process.env.OLLAMA_URL ?? "http://localhost:11434", process.env.OLLAMA_MODEL ?? "qwen2.5:3b"),
    apiBaseUrl: process.env.API_BASE_URL ?? apiBaseUrl,
    now: () => new Date(),
    id: randomUUID,
  };
}
