import { tmpdir } from "node:os";
import { join } from "node:path";
import { BullJobRunner } from "../shared/bullJobs";
import type { EventBus } from "../shared/events";
import { MemoryJobRunner, type JobRunner } from "../shared/jobs";
import { S3Storage } from "../shared/s3Storage";
import { FsStorage, type Storage } from "../shared/storage";

// S3_ENDPOINT set → the bucket (checked now, so a stopped MinIO is a clear boot error); otherwise files under DATA_DIR.
export async function createStorage(env: NodeJS.ProcessEnv, dataDir: string): Promise<Storage> {
  const endpoint = env.S3_ENDPOINT?.trim();
  if (!endpoint) return new FsStorage(dataDir);
  const s3 = new S3Storage({
    endpoint, bucket: env.S3_BUCKET || "captions", accessKeyId: env.S3_ACCESS_KEY ?? "", secretAccessKey: env.S3_SECRET_KEY ?? "",
    region: env.S3_REGION || "auto", workDir: env.WORK_DIR || join(tmpdir(), "sabi-work"),
  });
  try {
    await s3.ensureBucket();
  } catch (err) {
    throw new Error(`S3 storage at ${endpoint} not reachable — run \`make db\` or unset S3_ENDPOINT (${err instanceof Error ? err.message || err.name : String(err)})`);
  }
  return s3;
}

// REDIS_URL set → BullMQ (checked now, so a stopped Redis is a clear boot error); otherwise jobs live in this process.
export async function createJobRunner(redisUrl: string | undefined, bus: EventBus): Promise<JobRunner> {
  const url = redisUrl?.trim();
  if (!url) return new MemoryJobRunner(bus);
  const { Redis } = await import("ioredis");
  const probe = new Redis(url, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  probe.on("error", () => {}); // reported below, once
  try {
    await probe.connect();
    await probe.ping();
  } catch (err) {
    throw new Error(`Redis at ${url} not reachable — run \`make db\` or unset REDIS_URL (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    probe.disconnect();
  }
  return new BullJobRunner(url, bus);
}

// Remotion's browser registers a SIGTERM listener (to kill Chrome), and any listener stops Node's default exit: without this the
// API ignores SIGTERM (docker stop waits 10 s for SIGKILL). Close the shared browser, then exit; a job in flight resumes from the queue.
export const shutdownHandler = (renderer: { close?(): Promise<void> }, exit: (code: number) => void = (code) => process.exit(code)) => async () => {
  await renderer.close?.().catch(() => {});
  exit(0);
};

// The Host check (createApp) stops browsers, not a LAN machine that sends "Host: localhost" itself: listen on this Mac only.
// Docker sets HOST=0.0.0.0 (nginx and the render browser reach the api over its network) and publishes the port on 127.0.0.1.
export const listenHost = (env: NodeJS.ProcessEnv) => env.HOST?.trim() || "127.0.0.1";
