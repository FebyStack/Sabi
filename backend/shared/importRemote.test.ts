import { readdirSync, readFileSync } from "node:fs";
import { importAsAsset, importRemote } from "./importRemote";
import { PNG_1x1_BASE64 } from "./renderer";
import { FakeMedia } from "./media";
import { MEDIA_TEST, makeTestDeps } from "./testing";

const deps = () => makeTestDeps({ media: new FakeMedia({ durationMs: 0, width: 1, height: 1 }) });
const brollFiles = (d: ReturnType<typeof deps>) => { try { return readdirSync(d.storage.localPath("broll")); } catch { return []; } };

describe("importRemote", () => {
  it("imports https png into storage", async () => {
    const d = deps();
    const out = await importRemote(d, `${MEDIA_TEST}/one.png`, { expect: "image" });
    expect(out).toEqual({ key: "broll/id-1.png", mimeType: "image/png", info: { durationMs: 0, width: 1, height: 1 } });
    expect(readFileSync(d.storage.localPath(out.key))).toEqual(Buffer.from(PNG_1x1_BASE64, "base64"));
  });

  it("rejects http, oversize and wrong content-type", async () => {
    const d = deps();
    for (const url of ["http://media.test/one.png", `${MEDIA_TEST}/big.png`, `${MEDIA_TEST}/page.html`, `${MEDIA_TEST}/missing.png`]) {
      await expect(importRemote(d, url, { expect: "image" }), url).rejects.toThrow("bad_remote_media");
    }
    await expect(importRemote(d, `${MEDIA_TEST}/one.png`, { expect: "video" })).rejects.toThrow("bad_remote_media");
    expect(brollFiles(d)).toEqual([]);
  });

  it("rejects images over 8192 px", async () => {
    const d = makeTestDeps({ media: new FakeMedia({ durationMs: 0, width: 9000, height: 10 }) });
    await expect(importRemote(d, `${MEDIA_TEST}/one.png`, { expect: "image" })).rejects.toThrow("bad_remote_media");
    expect(brollFiles(d)).toEqual([]);
  });

  it("removes the file when the probe fails", async () => {
    const d = makeTestDeps({ media: { probe: async () => { throw new Error("ffprobe"); }, extractAudio: async () => {} } });
    await expect(importRemote(d, `${MEDIA_TEST}/clip.mp4`, { expect: "video" })).rejects.toThrow("bad_remote_media");
    expect(brollFiles(d)).toEqual([]);
  });
});

describe("importAsAsset", () => {
  it("stores the file and an asset carrying its provenance", async () => {
    const d = deps();
    const meta = { source: "stock" as const, attribution: { author: "Jane Doe", url: "https://www.pexels.com/photo/1" }, query: "sunrise" };
    const asset = await importAsAsset(d, { projectId: "p1", url: `${MEDIA_TEST}/one.png`, media: "image", meta });
    expect(asset).toMatchObject({ projectId: "p1", kind: "image", key: "broll/id-1.png", mimeType: "image/png", width: 1, height: 1, meta });
    expect(await d.assets.get(asset.id)).toEqual(asset);
    expect((await d.storage.stat(asset.key))?.size).toBeGreaterThan(0);
  });
});
