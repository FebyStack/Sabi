import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { checkKey, sweepScratch, type ByteRange, type Storage } from "./storage";

const notFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
};

// S3-compatible store (MinIO in dev, R2/S3 later), path-style. ffmpeg and Remotion get local copies under workDir (the Mac disk).
export class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;

  constructor(private o: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string; workDir: string; requestTimeoutMs?: number }) {
    this.bucket = o.bucket;
    this.client = new S3Client({
      endpoint: o.endpoint, region: o.region ?? "auto", forcePathStyle: true,
      credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
      // A black-holed host fails the boot check, and a wedged store fails a request (retried twice), instead of hanging them.
      // The request timeout runs until the response headers (an upload part's whole body), never through a streamed read.
      requestHandler: { connectionTimeout: 5000, requestTimeout: o.requestTimeoutMs ?? 60_000, throwOnRequestTimeout: true },
    });
  }

  // Boot check: the bucket exists (created on first use, e.g. a fresh MinIO).
  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (!notFound(err)) throw err;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  // Multipart for big streams, so a 2 GB upload never sits in memory.
  async write(key: string, data: Readable | Buffer) {
    await new Upload({ client: this.client, params: { Bucket: this.bucket, Key: checkKey(key), Body: data } }).done();
  }

  async read(key: string, range?: ByteRange) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key), ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
    return res.Body as Readable;
  }

  async stat(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
      return { size: head.ContentLength ?? 0 };
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }

  async remove(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkKey(key) })); }

  async put(key: string, localPath: string) {
    await this.write(key, createReadStream(localPath));
    await rm(localPath, { force: true });
  }

  async withLocalFile<T>(key: string, fn: (path: string) => Promise<T>) {
    const path = this.workPath(`downloads/${randomUUID()}${extname(key)}`);
    try {
      await pipeline(await this.read(key), createWriteStream(path));
      return await fn(path);
    } finally {
      await rm(path, { force: true });
    }
  }

  workPath(name: string) {
    const p = join(this.o.workDir, checkKey(name));
    mkdirSync(dirname(p), { recursive: true });
    return p;
  }

  sweepWork() { return sweepScratch(this.o.workDir); }

  // By bucket alone: the same MinIO is localhost:9000 from the Mac and minio:9000 from the api container.
  describe() { return `s3:${this.bucket}`; }
}
