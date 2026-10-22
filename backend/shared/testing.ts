import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllowedOrigins } from "../app/app";
import { MemoryAssetRepository } from "../modules/assets/repository";
import { MemoryProjectRepository } from "../modules/projects/repository";
import { JsonlCreditLedger, MemoryCreditLedger } from "../modules/usage/ledger";
import { parseSpendCap } from "../modules/usage/spend";
import type { AppDeps } from "./deps";
import { MemoryEventBus } from "./events";
import { MemoryJobRunner } from "./jobs";
import { FakeGenerator, FalGenerator } from "./generator";
import { FakeLlm, OllamaLlm, type LlmRequest } from "./llm";
import { FakeMedia, FfmpegMedia } from "./media";
import { FakeRenderer, PNG_1x1_BASE64, RemotionRenderer } from "./renderer";
import { FakeStock, PexelsStock, type StockResult } from "./stock";
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
    ...fakeBroll(),
    ledger: new MemoryCreditLedger(),
    spendCapCents: 2000,
    apiBaseUrl: "http://test",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    id: () => `id-${++n}`,
    ...overrides,
  };
}

// Remote B-roll media in tests: a fetch that serves these https URLs from memory (importRemote refuses http).
export const MEDIA_TEST = "https://media.test";
export const IMG1: StockResult = { url: `${MEDIA_TEST}/one.png`, media: "image", width: 1080, height: 1920, attribution: { author: "Jane Doe", url: "https://www.pexels.com/photo/1" } };
export const IMG2: StockResult = { url: `${MEDIA_TEST}/two.png`, media: "image", width: 1080, height: 1920, attribution: { author: "Jane Doe", url: "https://www.pexels.com/photo/2" } };
export const VID1: StockResult = { url: `${MEDIA_TEST}/clip.mp4`, media: "video", width: 1080, height: 1920, durationMs: 4000, attribution: { author: "Vid Eo", url: "https://www.pexels.com/video/1" } };

export function fixtureFetch(): typeof fetch {
  const png = Buffer.from(PNG_1x1_BASE64, "base64");
  const MiB = 1024 ** 2;
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== MEDIA_TEST) return new Response("not found", { status: 404 });
    switch (url.pathname) {
      case "/one.png": case "/two.png": return new Response(png, { headers: { "content-type": "image/png" } });
      case "/clip.mp4": return new Response("fake-mp4", { headers: { "content-type": "video/mp4" } });
      case "/page.html": return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      case "/big.png": { // declares exactly the cap, then streams past it
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({ pull(c) { if (sent++ < 51) c.enqueue(new Uint8Array(MiB)); else c.close(); } });
        return new Response(body, { headers: { "content-type": "image/png", "content-length": String(50 * MiB) } });
      }
      default: return new Response("not found", { status: 404 });
    }
  }) as typeof fetch;
}

// Pexels and fal.ai stand-ins: canned results served from memory (tests, FAKE_AI=1).
const fakeBroll = (): Pick<AppDeps, "fetch" | "stock" | "generator"> => ({
  fetch: fixtureFetch(),
  stock: new FakeStock((_q, { media, page }) => (media === "image" ? [page === 2 ? IMG2 : IMG1] : [VID1])),
  generator: new FakeGenerator((r) => `${MEDIA_TEST}/${r.media === "image" ? "one.png" : "clip.mp4"}`),
});

// Deterministic stand-in for Ollama, keyed off the request input: translations prefix each line, plans label every phrase.
export function fakeLlmResponder(req: LlmRequest): unknown {
  const input = JSON.parse(req.user);
  if (input.beats) {
    const beats: { i: number; text: string }[] = input.beats;
    return { labels: beats.map((b) => ({ i: b.i, query: "stock " + b.text.split(" ")[0], prompt: "photo of " + b.text, intent: b.text.split(" ").slice(0, 3).join(" "), wantsVideo: b.i === 1 })) };
  }
  if (input.lines) return { lines: input.lines.map((l: string) => `${input.language}: ${l}`) };
  const phrases: { i: number; text: string }[] = input.phrases;
  const third = phrases.filter((p) => p.i % 3 === 0);
  return {
    shots: third.map((p) => ({ from: p.i, kind: p.i === 0 ? "Hook" : (p.i / 3) % 2 ? "Talking Head" : "B-Roll" })),
    emphasis: phrases.map((p) => ({ phrase: p.i, word: p.text.split(" ")[0], kind: "keyword" })),
    emoji: third.map((p) => ({ phrase: p.i, emoji: "🔥" })),
  };
}

// FAKE_AI=1 swaps whisperX, Ollama, Pexels and fal.ai for fakes so the UI can be driven without any of them.
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
    renderer: new RemotionRenderer({ entry: "shared/remotion/index.ts" }),
    llm: fakeAi ? new FakeLlm(fakeLlmResponder) : new OllamaLlm(process.env.OLLAMA_URL ?? "http://localhost:11434", process.env.OLLAMA_MODEL ?? "qwen2.5:3b"),
    ...(fakeAi ? fakeBroll() : {
      fetch: globalThis.fetch,
      stock: process.env.PEXELS_KEY ? new PexelsStock(process.env.PEXELS_KEY, globalThis.fetch) : null,
      generator: process.env.FAL_KEY ? new FalGenerator(process.env.FAL_KEY, globalThis.fetch) : null,
    }),
    ledger: new JsonlCreditLedger(join(dataDir, "ledger.jsonl")), // survives tsx-watch restarts, so the cap does too
    spendCapCents: parseSpendCap(process.env.SPEND_CAP_CENTS),
    apiBaseUrl: process.env.API_BASE_URL ?? apiBaseUrl,
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
    now: () => new Date(),
    id: randomUUID,
  };
}
