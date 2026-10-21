import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editorProject } from "../../../shared/editing/fixtures";
import type { Asset } from "../../../shared/types";
import { makeTestDeps } from "../../shared/testing";
import { seedDemo } from "./seed";

const asset = (id: string, kind: Asset["kind"], key: string, mimeType: string): Asset =>
  ({ id, projectId: "demo", kind, key, mimeType, sizeBytes: 4, createdAt: "2026-01-01T00:00:00.000Z" });

function bundle() {
  const dir = mkdtempSync(join(tmpdir(), "demo-"));
  const assets = [asset("demo-src", "video", "clip.mp4", "video/mp4"), asset("demo-srt", "subtitle", "demo.srt", "text/plain")];
  for (const a of assets) writeFileSync(join(dir, a.key), `${a.id}!`);
  const project = editorProject({ id: "demo", demo: true, sourceAssetId: "demo-src", outputs: { srtAssetId: "demo-srt" } });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ project, assets }));
  return dir;
}

describe("demo seed", () => {
  it("seeds once", async () => {
    const deps = makeTestDeps();
    const dir = bundle();
    const p = await seedDemo(deps, dir);
    expect(p).toMatchObject({ id: "demo", demo: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(await deps.projects.get("demo")).toMatchObject({ demo: true, sourceAssetId: "demo-src" });
    const src = await deps.assets.get("demo-src");
    expect(src).toMatchObject({ key: "demo/clip.mp4", projectId: "demo", kind: "video" });
    expect(await deps.storage.stat("demo/clip.mp4")).toEqual({ size: "demo-src!".length });
    expect((await deps.assets.get("demo-srt"))!.key).toBe("demo/demo.srt");
    expect(await seedDemo(deps, dir)).toBeNull();
    expect(await deps.projects.list()).toHaveLength(1);
  });

  it("does not seed when projects exist", async () => {
    const deps = makeTestDeps();
    await deps.projects.create(editorProject({ id: "mine" }));
    expect(await seedDemo(deps, bundle())).toBeNull();
    expect(await deps.assets.get("demo-src")).toBeNull();
  });

  it("the committed bundle is valid and small", async () => {
    const deps = makeTestDeps();
    const p = await seedDemo(deps); // database/seed/demo
    expect(p).toMatchObject({ id: "demo", demo: true, status: "ready", sourceAssetId: "demo-src" });
    expect(p!.outputs).toMatchObject({ mp4AssetId: "demo-mp4", srtAssetId: "demo-srt", vttAssetId: "demo-vtt", resolution: "1080p" });
    expect(p!.overlays.map((o) => [o.id, o.assetId, o.source])).toEqual([["ov-0", "demo-ov-0", "stock"], ["ov-1", "demo-ov-1", "stock"]]);
    for (const o of p!.overlays) expect(o.attribution!.url).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
    expect(p!.brand).toBeTruthy();
    expect(p!.captionStyle).toBeTruthy();
    expect(p!.motionGraphics).toHaveLength(1);
    const assets = await deps.assets.listByProject("demo");
    expect(assets.map((a) => a.id).sort()).toEqual(["demo-mp4", "demo-ov-0", "demo-ov-1", "demo-src", "demo-srt", "demo-vtt"]);
    const total = (await Promise.all(assets.map((a) => deps.storage.stat(a.key)))).reduce((n, s) => n + s!.size, 0);
    expect(total).toBeLessThan(25 * 1024 ** 2);
  });
});
