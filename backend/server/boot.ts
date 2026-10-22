import { tmpdir } from "node:os";
import { join } from "node:path";
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
