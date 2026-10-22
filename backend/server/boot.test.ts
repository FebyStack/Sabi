import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsStorage } from "../shared/storage";
import { MemoryEventBus } from "../shared/events";
import { MemoryJobRunner } from "../shared/jobs";
import { createJobRunner, createStorage, listenHost, shutdownHandler } from "./boot";

describe("createStorage", () => {
  it("uses files under DATA_DIR without S3_ENDPOINT (or with an empty one)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "boot-"));
    expect(await createStorage({}, dir)).toBeInstanceOf(FsStorage);
    const s = await createStorage({ S3_ENDPOINT: " " }, dir);
    expect(s.describe()).toBe(`fs:${dir}`);
  });

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

describe("listenHost", () => {
  it("answers this Mac only unless HOST says otherwise (Docker sets 0.0.0.0 inside its own network)", () => {
    expect(listenHost({})).toBe("127.0.0.1"); // a LAN client could forge Host: localhost, so it must not reach the port at all
    expect(listenHost({ HOST: " " })).toBe("127.0.0.1");
    expect(listenHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });
});

