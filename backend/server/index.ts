import { randomUUID } from "node:crypto";
import { createApp, parseAllowedOrigins } from "../app/app";
import { PgAssetRepository } from "../modules/assets/repository";
import { PgProjectRepository } from "../modules/projects/repository";
import { PgCreditLedger } from "../modules/usage/ledger";
import { parseSpendCap } from "../modules/usage/spend";
import { seedDemo } from "../modules/demo/seed";
import { startRetention } from "../modules/retention/sweep";
import type { AppDeps } from "../shared/deps";
import { freeBytesOf } from "../shared/disk";
import { MemoryEventBus } from "../shared/events";
import { OllamaLlm } from "../shared/llm";
import { FalGenerator } from "../shared/generator";
import { FfmpegMedia } from "../shared/media";
import { applySchema, createPool, ensureStorageMatches } from "../shared/pg";
import { RemotionRenderer } from "../shared/renderer";
import { PexelsStock } from "../shared/stock";
import { WhisperXTranscriber } from "../shared/transcriber";
import { createJobRunner, createStorage, listenHost, shutdownHandler } from "./boot";

const port = Number(process.env.PORT ?? 3001);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (use `npm run dev:lite` for the in-memory server)");
const dataDir = process.env.DATA_DIR ?? "/Volumes/PortableSSD/Bong/captions-clone-data";
// Settings first: a typo fails the boot at once, not after the database, S3 and Redis checks.
const spendCapCents = parseSpendCap(process.env.SPEND_CAP_CENTS);
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

const pool = createPool(url);
await applySchema(pool);
const storage = await createStorage(process.env, dataDir);
await ensureStorageMatches(pool, storage.describe());
const projects = new PgProjectRepository(pool);
const bus = new MemoryEventBus();
const jobs = await createJobRunner(process.env.REDIS_URL, bus);
// A running status with no job behind it was interrupted for good; with BullMQ a queued/active job will resume (or fail "interrupted").
const resuming: string[] = [];
for (const p of await projects.list()) if (await jobs.active(p.id)) resuming.push(p.id);
const stuck = await projects.failStuck(resuming);
if (stuck) console.warn(`marked ${stuck} interrupted project(s) as failed`);

const deps: AppDeps = {
  projects,
  assets: new PgAssetRepository(pool),
  storage,
  media: new FfmpegMedia(),
  bus,
  jobs,
  transcriber: new WhisperXTranscriber(process.env.WHISPERX_URL ?? "http://localhost:8010"),
  renderer: new RemotionRenderer({ entry: "shared/remotion/index.ts" }),
  llm: new OllamaLlm(process.env.OLLAMA_URL ?? "http://localhost:11434", process.env.OLLAMA_MODEL ?? "qwen2.5:3b"),
  fetch: globalThis.fetch,
  stock: process.env.PEXELS_KEY ? new PexelsStock(process.env.PEXELS_KEY, globalThis.fetch) : null,
  generator: process.env.FAL_KEY ? new FalGenerator(process.env.FAL_KEY, globalThis.fetch) : null,
  ledger: new PgCreditLedger(pool),
  spendCapCents,
  apiBaseUrl: process.env.API_BASE_URL ?? `http://127.0.0.1:${port}`,
  allowedOrigins,
  freeBytes: freeBytesOf,
  now: () => new Date(),
  id: randomUUID,
};
const demo = await seedDemo(deps).catch((err) => { console.error("demo seed failed", err); return null; }); // only into an empty database
if (demo) console.log(`seeded demo project ${demo.id}`);
createApp(deps).listen(port, listenHost(process.env), () => console.log(`api (postgres) on http://localhost:${port}, files in ${storage.describe()}, jobs ${process.env.REDIS_URL ? "in Redis" : "in memory"}`));
await jobs.start?.(); // after createApp registered the handlers
startRetention(deps);
const warmStart = Date.now(); // bundle + browser now, so the first render or frame does not pay for them
deps.renderer.warm?.().then(() => console.log(`renderer warm in ${((Date.now() - warmStart) / 1000).toFixed(1)}s`), (err) => console.error("renderer warm-up failed", err));
const stop = shutdownHandler(deps.renderer);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
