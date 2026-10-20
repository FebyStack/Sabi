import { randomUUID } from "node:crypto";
import { createApp, parseAllowedOrigins } from "../app/app";
import { PgAssetRepository } from "../modules/assets/repository";
import { PgProjectRepository } from "../modules/projects/repository";
import { MemoryEventBus } from "../shared/events";
import { MemoryJobRunner } from "../shared/jobs";
import { OllamaLlm } from "../shared/llm";
import { FalGenerator } from "../shared/generator";
import { FfmpegMedia } from "../shared/media";
import { applySchema, createPool } from "../shared/pg";
import { RemotionRenderer } from "../shared/renderer";
import { PexelsStock } from "../shared/stock";
import { FsStorage } from "../shared/storage";
import { WhisperXTranscriber } from "../shared/transcriber";

const port = Number(process.env.PORT ?? 3001);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (use `npm run dev:lite` for the in-memory server)");
const dataDir = process.env.DATA_DIR ?? "/Volumes/PortableSSD/Bong/captions-clone-data";

const pool = createPool(url);
await applySchema(pool);
const projects = new PgProjectRepository(pool);
const stuck = await projects.failStuck(); // jobs are in-process; nothing survives a restart
if (stuck) console.warn(`marked ${stuck} interrupted project(s) as failed`);
const bus = new MemoryEventBus();

createApp({
  projects,
  assets: new PgAssetRepository(pool),
  storage: new FsStorage(dataDir),
  media: new FfmpegMedia(),
  bus,
  jobs: new MemoryJobRunner(bus),
  transcriber: new WhisperXTranscriber(process.env.WHISPERX_URL ?? "http://localhost:8010"),
  renderer: new RemotionRenderer({ entry: "shared/remotion/index.ts", bundleDir: ".remotion-bundle" }),
  llm: new OllamaLlm(process.env.OLLAMA_URL ?? "http://localhost:11434", process.env.OLLAMA_MODEL ?? "qwen2.5:3b"),
  fetch: globalThis.fetch,
  stock: process.env.PEXELS_KEY ? new PexelsStock(process.env.PEXELS_KEY, globalThis.fetch) : null,
  generator: process.env.FAL_KEY ? new FalGenerator(process.env.FAL_KEY, globalThis.fetch) : null,
  apiBaseUrl: process.env.API_BASE_URL ?? `http://127.0.0.1:${port}`,
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  now: () => new Date(),
  id: randomUUID,
}).listen(port, () => console.log(`api (postgres) on http://localhost:${port}, data in ${dataDir}`));
