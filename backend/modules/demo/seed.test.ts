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

  it("creates the project before its assets (assets.project_id is a foreign key in Postgres)", async () => {
    const deps = makeTestDeps();
    const create = deps.assets.create.bind(deps.assets);
    deps.assets.create = async (a) => {
      if (a.projectId && !(await deps.projects.get(a.projectId))) throw new Error(`fk violation: project ${a.projectId} missing`);
      return create(a);
    };
    expect(await seedDemo(deps, bundle())).toMatchObject({ id: "demo" });
    expect(await deps.assets.get("demo-src")).toBeTruthy();
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
    expect(p).toMatchObject({ id: "demo", demo: true, status: "ready", outputs: { resolution: "1080p" } });
    const assets = await deps.assets.listByProject("demo");
    const kind = new Map(assets.map((a) => [a.id, a.kind])); // ids change with every demo:pack, so check what they point at
    expect([p!.sourceAssetId, p!.outputs.mp4AssetId, p!.outputs.srtAssetId, p!.outputs.vttAssetId].map((id) => kind.get(id!))).toEqual(["video", "render", "subtitle", "subtitle"]);
    expect(p!.overlays.map((o) => [o.id, kind.get(o.assetId), o.source])).toEqual([["ov-0", "image", "stock"], ["ov-1", "image", "stock"]]);
    for (const o of p!.overlays) expect(o.attribution!.url).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
    expect(p!.brand).toBeTruthy();
    expect(p!.captionStyle).toBeTruthy();
    expect(p!.motionGraphics).toHaveLength(1);
    expect(assets).toHaveLength(6);
    const total = (await Promise.all(assets.map((a) => deps.storage.stat(a.key)))).reduce((n, s) => n + s!.size, 0);
    expect(total).toBeLessThan(25 * 1024 ** 2);
  });
});
