// Test utility (vitest globals): the behaviour every Storage must have. storage.test.ts runs it for files and, against MinIO, for S3.
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import type { Storage } from "./storage";

const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

export function storageContract(make: () => Promise<Storage>) {
  let s: Storage;
  beforeEach(async () => { s = await make(); });

  it("writes a buffer or a stream and reads it back whole or as a byte range", async () => {
    await s.write("a/one.bin", BYTES);
    await s.write("a/two.bin", Readable.from([BYTES.subarray(0, 400), BYTES.subarray(400)]));
    expect(await buffer(await s.read("a/one.bin"))).toEqual(BYTES);
    expect(await buffer(await s.read("a/two.bin"))).toEqual(BYTES);
    expect(await buffer(await s.read("a/one.bin", { start: 100, end: 199 }))).toEqual(BYTES.subarray(100, 200)); // end is inclusive
    expect(await buffer(await s.read("a/one.bin", { start: 999, end: 999 }))).toEqual(BYTES.subarray(999));
  });

  it("stat gives the size, null when missing; remove is idempotent; read of a missing key rejects", async () => {
    await s.write("b/x.bin", BYTES);
    expect(await s.stat("b/x.bin")).toEqual({ size: 1000 });
    expect(await s.stat("b/missing.bin")).toBeNull();
    await s.remove("b/x.bin");
    await s.remove("b/x.bin");
    expect(await s.stat("b/x.bin")).toBeNull();
    await expect(s.read("b/x.bin")).rejects.toThrow();
  });

  it("put moves a finished local file in; withLocalFile hands back a readable path", async () => {
    const local = s.workPath("tests/done.bin");
    writeFileSync(local, BYTES);
    await s.put("c/done.bin", local);
    expect(existsSync(local)).toBe(false);
    expect(await s.stat("c/done.bin")).toEqual({ size: 1000 });
    const seen = await s.withLocalFile("c/done.bin", async (path) => readFileSync(path));
    expect(seen).toEqual(BYTES);
    await expect(s.withLocalFile("c/missing.bin", async () => 1)).rejects.toThrow();
  });

  it("workPath gives distinct writable scratch paths", () => {
    const a = s.workPath("tests/deep/a.bin"), b = s.workPath("tests/deep/b.bin");
    expect(a).not.toBe(b);
    writeFileSync(a, "x"); // its folder exists
    expect(readFileSync(a, "utf8")).toBe("x");
  });

  it("sweepWork drops scratch nothing touched for an hour (a crash's leftovers) with its emptied folders, and keeps fresh files", async () => {
    const hoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const partial = s.workPath("renders/p1/partial.mp4"), live = s.workPath("uploads/live.mp4"), empty = dirname(s.workPath("frames/p1/x.png"));
    writeFileSync(partial, "x");
    writeFileSync(live, "y");
    for (const p of [partial, dirname(partial), empty]) utimesSync(p, hoursAgo, hoursAgo);
    await s.sweepWork();
    expect([existsSync(partial), existsSync(dirname(partial)), existsSync(empty)]).toEqual([false, false, false]);
    expect(readFileSync(live, "utf8")).toBe("y"); // another API on the same folder may be mid-upload
    writeFileSync(s.workPath("frames/p2.png"), "z"); // scratch still works
  });

  it("refuses keys that could leave the store", async () => {
    for (const key of ["../x", "/abs", "a//b", "", "a/../b", "a\\b", "./a"]) {
      await expect(s.write(key, BYTES), key).rejects.toThrow("bad_key");
      await expect(s.stat(key), key).rejects.toThrow("bad_key");
      expect(() => s.workPath(key), key).toThrow("bad_key");
    }
    expect(s.describe()).toMatch(/^(fs|s3):/);
  });
}
