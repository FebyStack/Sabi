import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
