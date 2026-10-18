import { randomUUID } from "node:crypto";
import { createApp } from "../app/app";
import { PgAssetRepository } from "../modules/assets/repository";
import { PgProjectRepository } from "../modules/projects/repository";
import { MemoryEventBus } from "../shared/events";
import { MemoryJobRunner } from "../shared/jobs";
import { FfmpegMedia } from "../shared/media";
import { applySchema, createPool } from "../shared/pg";
import { FsStorage } from "../shared/storage";
import { WhisperXTranscriber } from "../shared/transcriber";

const port = Number(process.env.PORT ?? 3001);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (use `npm run dev:lite` for the in-memory server)");
const dataDir = process.env.DATA_DIR ?? "/Volumes/PortableSSD/Bong/captions-clone-data";

const pool = createPool(url);
await applySchema(pool);
const bus = new MemoryEventBus();

createApp({
  projects: new PgProjectRepository(pool),
  assets: new PgAssetRepository(pool),
  storage: new FsStorage(dataDir),
  media: new FfmpegMedia(),
  bus,
  jobs: new MemoryJobRunner(bus),
  transcriber: new WhisperXTranscriber(process.env.WHISPERX_URL ?? "http://localhost:8010"),
  now: () => new Date(),
  id: randomUUID,
}).listen(port, () => console.log(`api (postgres) on http://localhost:${port}, data in ${dataDir}`));
