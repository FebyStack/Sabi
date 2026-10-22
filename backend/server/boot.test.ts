import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FsStorage } from "../shared/storage";
import { MemoryEventBus } from "../shared/events";
import { MemoryJobRunner } from "../shared/jobs";
import { createJobRunner, createStorage, listenHost, shutdownHandler } from "./boot";

const hoursAgo = new Date(Date.now() - 2 * 3_600_000);
const leftover = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "x"); utimesSync(path, hoursAgo, hoursAgo); return path; };

describe("createStorage", () => {
  it("uses files under DATA_DIR without S3_ENDPOINT (or with an empty one)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "boot-"));
    expect(await createStorage({}, dir)).toBeInstanceOf(FsStorage);
    const s = await createStorage({ S3_ENDPOINT: " " }, dir);
    expect(s.describe()).toBe(`fs:${dir}`);
  });

  it("opening the storage at boot (before any job runs) sweeps the scratch a crash left", async () => {
    const dir = mkdtempSync(join(tmpdir(), "boot-"));
    const partial = leftover(join(dir, "work", "renders", "p1-a.mp4"));
    const stored = leftover(join(dir, "renders", "p1", "a.mp4")); // the store itself is never swept
    await createStorage({}, dir);
    expect([existsSync(partial), existsSync(stored)]).toEqual([false, true]);
  });

  // Real MinIO from `make db` (npm run test:infra).
  it.skipIf(!process.env.S3_TEST_ENDPOINT)("with S3, scratch is a sabi-work folder inside WORK_DIR, so a sweep never touches anything else there", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "boot-work-"));
    const mine = leftover(join(workDir, "notes.txt")); // e.g. WORK_DIR pointed at a folder of the user's
    const env = { S3_ENDPOINT: process.env.S3_TEST_ENDPOINT, S3_BUCKET: `sabi-test-${randomUUID().slice(0, 8)}`, S3_ACCESS_KEY: process.env.S3_TEST_ACCESS_KEY, S3_SECRET_KEY: process.env.S3_TEST_SECRET_KEY };
    const s = await createStorage({ ...env, WORK_DIR: workDir }, "/unused");
    expect(s.workPath("a.bin")).toBe(join(workDir, "sabi-work", "a.bin"));
    expect(existsSync(mine)).toBe(true);
    await new S3Client({ endpoint: env.S3_ENDPOINT, region: "auto", forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! } })
      .send(new DeleteBucketCommand({ Bucket: env.S3_BUCKET })); // createStorage made it
  }, 30_000);

  it("fails clearly when the S3 endpoint can't be reached", async () => {
    const err = await createStorage({ S3_ENDPOINT: "http://127.0.0.1:1", S3_BUCKET: "b", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s" }, "/x").catch((e) => e);
    expect(err.message).toMatch(/^S3 storage at http:\/\/127\.0\.0\.1:1 not reachable — run `make db` or unset S3_ENDPOINT/);
  }, 30_000);
});

describe("createJobRunner", () => {
  it("is in-memory without REDIS_URL (or with an empty one)", async () => {
    expect(await createJobRunner(undefined, new MemoryEventBus())).toBeInstanceOf(MemoryJobRunner);
    expect(await createJobRunner("", new MemoryEventBus())).toBeInstanceOf(MemoryJobRunner);
  });

  it("fails clearly when Redis can't be reached", async () => {
    const err = await createJobRunner("redis://127.0.0.1:1", new MemoryEventBus()).catch((e) => e);
    expect(err.message).toMatch(/^Redis at redis:\/\/127\.0\.0\.1:1 not reachable — run `make db` or unset REDIS_URL/);
  }, 15_000);
});

describe("shutdownHandler", () => {
  it("closes the render browser, then exits 0", async () => {
    const order: string[] = [];
    const stop = shutdownHandler({ close: async () => { order.push("close"); } }, (code) => order.push(`exit ${code}`));
    await stop();
    expect(order).toEqual(["close", "exit 0"]);
  });

  it("still exits when closing the browser fails", async () => {
    const exits: number[] = [];
    await shutdownHandler({ close: async () => { throw new Error("gone"); } }, (code) => exits.push(code))();
    expect(exits).toEqual([0]);
  });
});

describe("server boot", () => {
  it("a bad SPEND_CAP_CENTS stops the boot before any database, S3 or Redis check", async () => {
    const env = { ...process.env, SPEND_CAP_CENTS: "lots", DATABASE_URL: "postgres://127.0.0.1:1/none", S3_ENDPOINT: "http://127.0.0.1:1", REDIS_URL: "redis://127.0.0.1:1" };
    const out = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      execFile(join("node_modules", ".bin", "tsx"), ["backend/server/index.ts"], { env, timeout: 60_000 }, (err, _stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stderr }));
    });
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("SPEND_CAP_CENTS must be a whole number of cents"); // not "ECONNREFUSED" from whichever check ran first
  }, 60_000);
});

describe("listenHost", () => {
  it("answers this Mac only unless HOST says otherwise (Docker sets 0.0.0.0 inside its own network)", () => {
    expect(listenHost({})).toBe("127.0.0.1"); // a LAN client could forge Host: localhost, so it must not reach the port at all
    expect(listenHost({ HOST: " " })).toBe("127.0.0.1");
    expect(listenHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });
});

