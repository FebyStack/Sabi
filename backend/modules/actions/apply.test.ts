import request from "supertest";
import { readyProject, untilStatus } from "../../shared/apiTestHelpers";
import { makeTestDeps } from "../../shared/testing";
import type { Asset, Overlay, Project } from "../../../shared/types";
import { applyActions, referencedAssetIds } from "./apply";

let project: Project;
beforeAll(async () => {
  const { a, project: ready } = await readyProject(makeTestDeps());
  await request(a).post(`/api/projects/${ready.id}/plan`).send({ languages: ["es"] });
  await vi.waitFor(async () => expect((await untilStatus(a, ready.id, "ready")).editPlan).toBeTruthy());
  project = (await request(a).get(`/api/projects/${ready.id}`)).body;
});

describe("applyActions", () => {
  it("folds mixed actions into one patch", () => {
    const cut = project.editPlan!.cuts[0];
    const ph = project.phrases[1];
    const out = applyActions(project, [
      { type: "setTitle", title: "Morning routine" },
      { type: "editPhrase", phraseId: ph.id, text: "Totally new words here" },
      { type: "setCut", cutId: cut.id, shouldTrim: !cut.shouldTrim },
      { type: "setTemplate", captionTemplateId: "bold" },
    ]);
    if ("error" in out) throw new Error(out.error);
    expect(out.rerender).toBe(true);
    expect(out.patch.title).toBe("Morning routine");
    expect(out.patch.captionTemplateId).toBe("bold");
    expect(out.patch.editPlan!.cuts.find((c) => c.id === cut.id)!.shouldTrim).toBe(!cut.shouldTrim);
    const text = out.patch.phrases!.flatMap((p) => p.words.map((w) => w.text)).join(" ");
    expect(text).toContain("Totally new words here");
    expect(project.phrases[1]).toEqual(ph); // pure: the input is untouched
  });

  it("unknown ids fail the whole batch", () => {
    const out = applyActions(project, [
      { type: "setTitle", title: "x" },
      { type: "setCut", cutId: "cut-nope", shouldTrim: true },
    ]);
    expect(out).toEqual({ error: "unknown_id", id: "cut-nope" });
    expect(applyActions(project, [{ type: "editPhrase", phraseId: "ph-nope", text: "a" }])).toEqual({ error: "unknown_id", id: "ph-nope" });
    expect(applyActions(project, [{ type: "setShotKind", shotId: "shot-nope", kind: "Hook" }])).toEqual({ error: "unknown_id", id: "shot-nope" });
  });

  it("setTitle alone needs no rerender", () => {
    expect(applyActions(project, [{ type: "setTitle", title: "x" }])).toEqual({ patch: { title: "x" }, rerender: false });
    const shot = applyActions(project, [{ type: "setShotKind", shotId: "shot-0", kind: "B-Roll" }]);
    expect(shot).toMatchObject({ rerender: false });
  });

  it("setBurnIn requires a translation", () => {
    expect(applyActions(project, [{ type: "setBurnIn", language: "fr" }])).toEqual({ error: "bad_burn_in" });
    expect(applyActions(project, [{ type: "setBurnIn", language: "es" }])).toEqual({ patch: { burnInLanguage: "es" }, rerender: true });
  });

  it("plan and caption actions need a plan and captions", () => {
    const bare = { ...project, editPlan: null, phrases: [] };
    expect(applyActions(bare, [{ type: "setCut", cutId: "cut-0", shouldTrim: true }])).toEqual({ error: "no_plan" });
    expect(applyActions(bare, [{ type: "editPhrase", phraseId: "ph-0", text: "a" }])).toEqual({ error: "no_captions" });
  });
});

const asset = (id: string, kind: Asset["kind"], extra: Partial<Asset> = {}): Asset =>
  ({ id, projectId: null, kind, key: `k/${id}`, mimeType: "x", sizeBytes: 1, createdAt: "", ...extra });
const assets = (...xs: Asset[]) => ({ assets: new Map(xs.map((a) => [a.id, a])) });
const MG_CODE = "const Component = ({ item }) => <div>{item.props.title}</div>;";

describe("applyActions: overlays, brand, motion graphics", () => {
  let p: Project;
  beforeAll(() => {
    const shot = project.editPlan!.shots.find((s) => s.kind === "B-Roll")!;
    const ov = (n: number, extra: Partial<Overlay> = {}): Overlay => ({
      id: `ov-${n}`, shotId: shot.id, assetId: `a${n}`, media: "image", source: "stock", startMs: shot.startMs + 300, endMs: shot.startMs + 2300,
      placement: "full", transition: "fade", enabled: true, query: "q", prompt: "p", intent: "i", attribution: { author: "A", url: "https://www.pexels.com/photo/1" }, ...extra,
    });
    p = { ...project, sourceDurationMs: 21000, overlays: [ov(0), ov(1)] };
  });
  const shotOf = () => project.editPlan!.shots.find((s) => s.kind === "B-Roll")!;

  it("overlay actions validate ranges and ids", () => {
    const shot = shotOf();
    const ok = applyActions(p, [{ type: "setOverlay", overlayId: "ov-0", startMs: shot.startMs, endMs: shot.endMs, placement: "top", enabled: false }]);
    if ("error" in ok) throw new Error(ok.error);
    expect(ok.rerender).toBe(true);
    expect(ok.patch.overlays![0]).toMatchObject({ startMs: shot.startMs, endMs: shot.endMs, placement: "top", enabled: false });
    expect(ok.patch.overlays![1]).toEqual(p.overlays[1]);
    expect(applyActions(p, [{ type: "setOverlay", overlayId: "ov-0", endMs: shot.endMs + 1 }])).toEqual({ error: "out_of_shot", id: "ov-0" });
    expect(applyActions(p, [{ type: "setOverlay", overlayId: "ov-0", startMs: shot.startMs - 1 }])).toEqual({ error: "out_of_shot", id: "ov-0" });
    expect(applyActions(p, [{ type: "setOverlay", overlayId: "ov-9", enabled: false }])).toEqual({ error: "unknown_id", id: "ov-9" });
    const removed = applyActions(p, [{ type: "removeOverlay", overlayId: "ov-0" }]);
    expect(removed).toMatchObject({ rerender: true, patch: { overlays: [p.overlays[1]] } });
    expect(applyActions(p, [{ type: "removeOverlay", overlayId: "ov-9" }])).toEqual({ error: "unknown_id", id: "ov-9" });
  });

  it("a stale overlay can still be toggled but not retimed", () => {
    const stale = { ...p, overlays: [{ ...p.overlays[0], shotId: "shot-gone" }] };
    expect(applyActions(stale, [{ type: "setOverlay", overlayId: "ov-0", enabled: false }])).toMatchObject({ patch: { overlays: [{ enabled: false }] } });
    expect(applyActions(stale, [{ type: "setOverlay", overlayId: "ov-0", endMs: 5000 }])).toEqual({ error: "out_of_shot", id: "ov-0" });
  });

  it("replace needs an image or video asset", () => {
    expect(applyActions(p, [{ type: "replaceOverlay", overlayId: "ov-0", assetId: "wav" }], assets(asset("wav", "audio")))).toEqual({ error: "bad_asset", id: "wav" });
    expect(applyActions(p, [{ type: "replaceOverlay", overlayId: "ov-0", assetId: "nope" }], assets())).toEqual({ error: "bad_asset", id: "nope" });
    const img = applyActions(p, [{ type: "replaceOverlay", overlayId: "ov-0", assetId: "png" }], assets(asset("png", "image")));
    if ("error" in img) throw new Error(img.error);
    expect(img.patch.overlays![0]).toMatchObject({ assetId: "png", media: "image", source: "uploaded" });
    expect(img.patch.overlays![0].attribution).toBeUndefined();
    const vid = applyActions(p, [{ type: "replaceOverlay", overlayId: "ov-0", assetId: "mp4" }], assets(asset("mp4", "video", { durationMs: 3000 })));
    expect("patch" in vid && vid.patch.overlays![0]).toMatchObject({ media: "video", durationMs: 3000 });
  });

  it("image props and logos must be image assets", () => {
    const brand = { palette: { primary: "#1E90FF", accent: "#FFD60A", text: "#FFFFFF", background: "#0B0B0B" }, fontFamily: "Inter", logoAssetId: "mp4", grade: 0.4 };
    expect(applyActions(p, [{ type: "setBrand", brand }], assets(asset("mp4", "video")))).toEqual({ error: "bad_asset", id: "mp4" });
    expect(applyActions(p, [{ type: "setBrand", brand: { ...brand, logoAssetId: "png" } }], assets(asset("png", "image")))).toMatchObject({ rerender: true, patch: { brand: { logoAssetId: "png" } } });
    const mg = { type: "addMotionGraphic" as const, name: "Logo", code: MG_CODE, startMs: 0, endMs: 2000, box: { x: 0, y: 0, w: 1, h: 1 }, props: [{ key: "logo", type: "image" as const, value: "missing" }] };
    expect(applyActions(p, [mg], assets())).toEqual({ error: "bad_asset", id: "missing" });
    expect(referencedAssetIds([mg, { type: "setBrand", brand }, { type: "replaceOverlay", overlayId: "ov-0", assetId: "x" }])).toEqual(["missing", "mp4", "x"]);
  });

  it("adds compiles and ids motion graphics", () => {
    const add = (name: string) => ({ type: "addMotionGraphic" as const, name, code: MG_CODE, startMs: 1000, endMs: 3000, box: { x: 0, y: 0, w: 1, h: 0.5 }, props: [{ key: "title", type: "text" as const, value: "42%" }] });
    const two = applyActions(p, [add("A"), add("B")]);
    if ("error" in two) throw new Error(two.error);
    expect(two.rerender).toBe(true);
    expect(two.patch.motionGraphics!.map((m) => m.id)).toEqual(["mg-0", "mg-1"]);
    expect(two.patch.motionGraphics![0].compiled).toContain("React.createElement");
    const afterDelete = applyActions({ ...p, motionGraphics: two.patch.motionGraphics! }, [{ type: "removeMotionGraphic", mgId: "mg-0" }, add("C")]);
    expect(afterDelete).toMatchObject({ patch: { motionGraphics: [{ id: "mg-1" }, { id: "mg-2", name: "C" }] } });
    const upd = applyActions({ ...p, motionGraphics: two.patch.motionGraphics! }, [{ type: "updateMotionGraphic", mgId: "mg-1", enabled: false, code: "const Component = () => null;" }]);
    expect(upd).toMatchObject({ patch: { motionGraphics: [{ id: "mg-0" }, { id: "mg-1", enabled: false, code: "const Component = () => null;" }] } });
    expect(applyActions(p, [{ type: "updateMotionGraphic", mgId: "mg-7", enabled: false }])).toEqual({ error: "unknown_id", id: "mg-7" });
  });

  it("bad code rejects the batch", () => {
    const out = applyActions(p, [{ type: "setTitle", title: "x" }, { type: "addMotionGraphic", name: "x", code: "const Component = () => { fetch('https://x'); return null; };", startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: [] }]);
    expect(out).toMatchObject({ error: "bad_code" });
    expect("detail" in out && out.detail).toContain("forbidden: fetch");
  });

  it("motion graphics stay inside the source", () => {
    const mg = { type: "addMotionGraphic" as const, name: "x", code: MG_CODE, startMs: 0, endMs: 99999, box: { x: 0, y: 0, w: 1, h: 1 }, props: [] };
    expect(applyActions(p, [mg])).toEqual({ error: "out_of_range" });
    expect(applyActions({ ...p, sourceDurationMs: null }, [{ ...mg, endMs: 1000 }])).toEqual({ error: "no_source" });
  });

  it("setMediaSource alone needs no rerender", () => {
    expect(applyActions(p, [{ type: "setMediaSource", mediaSource: "stock" }])).toEqual({ patch: { mediaSource: "stock" }, rerender: false });
  });

  it("shot kind rerenders only when overlays exist", () => {
    const flip = [{ type: "setShotKind" as const, shotId: shotOf().id, kind: "Talking Head" as const }];
    expect(applyActions(p, flip)).toMatchObject({ rerender: true });
    expect(applyActions({ ...p, overlays: [] }, flip)).toMatchObject({ rerender: false });
  });
});
