import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsStorage } from "../shared/storage";
import { createStorage } from "./boot";

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
