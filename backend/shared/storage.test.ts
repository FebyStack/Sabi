import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteBucketCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { S3Storage } from "./s3Storage";
import { FsStorage } from "./storage";
import { storageContract } from "./storageContract";

describe("FsStorage", () => {
  storageContract(async () => new FsStorage(mkdtempSync(join(tmpdir(), "fs-store-"))));

  it("describes itself by its root, and keeps scratch files under work/", () => {
    const root = mkdtempSync(join(tmpdir(), "fs-store-"));
    const s = new FsStorage(root);
    expect(s.describe()).toBe(`fs:${root}`);
    expect(s.workPath("audio/p1.wav")).toBe(join(root, "work", "audio", "p1.wav")); // same disk as the store: put is a rename
  });
});

describe("S3Storage timeouts", () => {
  it("a store that takes the connection but never answers fails the request instead of hanging it", async () => {
    const server = createServer(() => {}); // reads each request, answers none (a wedged MinIO)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const s = new S3Storage({ endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bucket: "b", accessKeyId: "k", secretAccessKey: "s",
      workDir: mkdtempSync(join(tmpdir(), "s3-work-")), requestTimeoutMs: 200 });
    await expect(s.stat("a.bin")).rejects.toMatchObject({ name: "TimeoutError" }); // the file route answers 500 instead of never
    server.closeAllConnections();
    server.close();
  });
});

// Real MinIO from `make db`; opt in with S3_TEST_ENDPOINT (npm run test:infra). One throwaway bucket per run.
const endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)("S3Storage", { timeout: 60_000 }, () => {
  const bucket = `sabi-test-${randomUUID().slice(0, 8)}`;
  const creds = { accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? "", secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? "" };
  const make = async () => {
    const s = new S3Storage({ endpoint: endpoint!, bucket, ...creds, workDir: mkdtempSync(join(tmpdir(), "s3-work-")) });
    await s.ensureBucket(); // creates it the first time
    return s;
  };
  afterAll(async () => {
    const client = new S3Client({ endpoint, region: "auto", forcePathStyle: true, credentials: creds });
    const { Contents = [] } = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    if (Contents.length) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: Contents.map((o) => ({ Key: o.Key! })) } }));
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  });

  storageContract(make);

  it("describes itself by bucket (one MinIO is localhost:9000 on the Mac and minio:9000 in Docker); withLocalFile leaves no download behind", async () => {
    const s = await make();
    expect(s.describe()).toBe(`s3:${bucket}`);
    expect(new S3Storage({ endpoint: "http://minio:9000", bucket, ...creds, workDir: tmpdir() }).describe()).toBe(s.describe());
    await s.write("d/x.bin", Buffer.from("hello"));
    const seen = await s.withLocalFile("d/x.bin", async (path) => path);
    expect(existsSync(seen)).toBe(false);
  });
});

