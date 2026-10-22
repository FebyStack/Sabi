import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { importAsAsset, importRemote } from "./importRemote";
import { PNG_1x1_BASE64 } from "./renderer";
import { FakeMedia, type Media } from "./media";
import { FsStorage } from "./storage";
import { MEDIA_TEST, makeTestDeps } from "./testing";

const roots = new WeakMap<object, string>();
const deps = (media: Media = new FakeMedia({ durationMs: 0, width: 1, height: 1 })) => {
  const root = mkdtempSync(join(tmpdir(), "import-"));
  const d = makeTestDeps({ media, storage: new FsStorage(root) });
  roots.set(d, root);
  return d;
};
// Nothing may be left behind after a refusal: no stored B-roll, no scratch download.
const leftovers = (d: ReturnType<typeof deps>) => ["broll", "work/imports"].flatMap((dir) => { try { return readdirSync(join(roots.get(d)!, dir)); } catch { return []; } });

describe("importRemote", () => {
  it("imports https png into storage", async () => {
    const d = deps();
    const out = await importRemote(d, `${MEDIA_TEST}/one.png`, { expect: "image" });
    expect(out).toEqual({ key: "broll/id-1.png", mimeType: "image/png", info: { durationMs: 0, width: 1, height: 1 } });
    expect(await buffer(await d.storage.read(out.key))).toEqual(Buffer.from(PNG_1x1_BASE64, "base64"));
    expect(leftovers(d)).toEqual(["id-1.png"]); // the stored file only
  });

  it("rejects http, oversize and wrong content-type", async () => {
    const d = deps();
    for (const url of ["http://media.test/one.png", `${MEDIA_TEST}/big.png`, `${MEDIA_TEST}/page.html`, `${MEDIA_TEST}/missing.png`]) {
      await expect(importRemote(d, url, { expect: "image" }), url).rejects.toThrow("bad_remote_media");
    }
    await expect(importRemote(d, `${MEDIA_TEST}/one.png`, { expect: "video" })).rejects.toThrow("bad_remote_media");
    expect(leftovers(d)).toEqual([]);
  });

  it("rejects images over 8192 px", async () => {
    const d = deps(new FakeMedia({ durationMs: 0, width: 9000, height: 10 }));
    await expect(importRemote(d, `${MEDIA_TEST}/one.png`, { expect: "image" })).rejects.toThrow("bad_remote_media");
    expect(leftovers(d)).toEqual([]);
  });

  it("removes the file when the probe fails", async () => {
    const d = deps({ probe: async () => { throw new Error("ffprobe"); }, extractAudio: async () => {}, sanitize: async () => {} });
    await expect(importRemote(d, `${MEDIA_TEST}/clip.mp4`, { expect: "video" })).rejects.toThrow("bad_remote_media");
    expect(leftovers(d)).toEqual([]);
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

  it("imported media is sanitized before it is stored", async () => {
    class CleaningMedia extends FakeMedia {
      async sanitize(_input: string, output: string) { writeFileSync(output, "CLEAN"); }
    }
    const d = deps(new CleaningMedia({ durationMs: 0, width: 1, height: 1 }));
    const out = await importRemote(d, `${MEDIA_TEST}/one.png`, { expect: "image" });
    expect((await buffer(await d.storage.read(out.key))).toString()).toBe("CLEAN");
    expect(leftovers(d)).toEqual(["id-1.png"]);
  });
});

