import request from "supertest";
import type { createApp } from "../../app/app";
import { readyProject, untilStatus } from "../../shared/apiTestHelpers";
import type { AppDeps } from "../../shared/deps";
import { FakeGenerator } from "../../shared/generator";
import { FakeRenderer } from "../../shared/renderer";
import { FakeStock } from "../../shared/stock";
import { IMG1, IMG2, VID1, makeTestDeps } from "../../shared/testing";
import { staleOverlays } from "../../../shared/editing/overlays";
import type { Action, JobState, MediaSource, Project } from "../../../shared/types";

type App = ReturnType<typeof createApp>;
const get = async (a: App, id: string): Promise<Project> => (await request(a).get(`/api/projects/${id}`)).body;
const act = async (a: App, id: string, actions: Action[], render = false) => {
  const res = await request(a).post(`/api/projects/${id}/actions`).send({ baseVersion: (await get(a, id)).updatedAt, actions, render });
  expect([200, 202]).toContain(res.status);
  if (res.status === 202) await untilStatus(a, id, "ready");
  return res;
};
const untilJob = async (a: App, id: string, state: JobState["state"]) => {
  let job: JobState | undefined;
  await vi.waitFor(async () => { job = (await request(a).get(`/api/projects/${id}/job`)).body; expect(job!.state).toBe(state); }, { timeout: 5000 });
  return job!;
};
const broll = async (a: App, id: string, body: object = {}) => {
  const res = await request(a).post(`/api/projects/${id}/broll`).send(body);
  expect(res.status).toBe(202);
  await untilJob(a, id, "COMPLETE");
  return get(a, id);
};

// readyProject → plan (fake: shot-0 Hook, shot-1 Talking Head, shot-2 B-Roll) → shot-1 becomes "Talking Head & B-Roll", so two beats.
async function plannedProject(deps: AppDeps, mediaSource: MediaSource = "stock") {
  const { a, project } = await readyProject(deps);
  await request(a).post(`/api/projects/${project.id}/plan`).send({});
  await vi.waitFor(async () => expect((await untilStatus(a, project.id, "ready")).editPlan).toBeTruthy());
  await act(a, project.id, [{ type: "setShotKind", shotId: "shot-1", kind: "Talking Head & B-Roll" }, { type: "setMediaSource", mediaSource }]);
  return { a, project: await get(a, project.id) };
}

describe("b-roll api", () => {
  it("adds overlays for b-roll shots and renders", async () => {
    const deps = makeTestDeps();
    const { a, project } = await plannedProject(deps);
    const done = await broll(a, project.id);
    const shots = project.editPlan!.shots;
    expect(done.status).toBe("ready");
    expect(done.overlays).toHaveLength(2);
    expect(done.overlays.map((o) => [o.id, o.shotId, o.source, o.media, o.placement, o.startMs])).toEqual([
      ["ov-0", "shot-1", "stock", "image", "top", shots[1].startMs + 300],
      ["ov-1", "shot-2", "stock", "image", "full", shots[2].startMs + 300],
    ]);
    expect(done.overlays[0].attribution).toEqual(IMG1.attribution);
    expect(done.overlays[0]).toMatchObject({ query: "stock smoothie.", transition: "fade", enabled: true });
    expect(done.outputs.mp4AssetId).not.toBe(project.outputs.mp4AssetId);
    expect((deps.renderer as FakeRenderer).calls.at(-1)!.inputProps.overlays).toHaveLength(2);
    const asset = (await request(a).get(`/api/assets/${done.overlays[0].assetId}/file`));
    expect(asset.headers["content-type"]).toContain("image/png");
    expect((await deps.assets.get(done.overlays[0].assetId))?.meta).toEqual({ source: "stock", attribution: IMG1.attribution, query: "stock smoothie." });
  });

  it("generate mode uses the generator and charges credits", async () => {
    const deps = makeTestDeps();
    const { a, project } = await plannedProject(deps, "generate");
    const done = await broll(a, project.id);
    expect((deps.generator as FakeGenerator).calls.map((c) => c.media)).toEqual(["image", "video"]);
    expect(done.overlays.map((o) => [o.source, o.media])).toEqual([["generated", "image"], ["generated", "video"]]);
    expect(done.overlays[1].durationMs).toBeGreaterThan(0);
    expect(done.overlays[1].generationInfo).toMatchObject({ provider: "fal", costCents: 25, prompt: expect.stringMatching(/^photo of me, that is making my bed/) });
    expect(done.creditsUsedCents).toBe(26);
    expect((await deps.assets.get(done.overlays[1].assetId))?.meta).toEqual({ source: "generated", generationInfo: done.overlays[1].generationInfo, prompt: done.overlays[1].prompt });
  });

  it("generation failure falls back to stock", async () => {
    const deps = makeTestDeps({ generator: new FakeGenerator(() => new Error("generator_unavailable")) });
    const { a, project } = await plannedProject(deps, "generate");
    const done = await broll(a, project.id);
    expect(done.overlays.map((o) => [o.source, o.media])).toEqual([["stock", "image"], ["stock", "video"]]);
    expect(done.overlays[1].attribution).toEqual(VID1.attribution);
    expect(done.warnings).toEqual([]);
    expect(done.creditsUsedCents).toBe(0);
  });

  it("no b-roll shots completes with a warning", async () => {
    const { a, project } = await plannedProject(makeTestDeps());
    await act(a, project.id, [{ type: "setShotKind", shotId: "shot-1", kind: "Talking Head" }, { type: "setShotKind", shotId: "shot-2", kind: "Talking Head" }]);
    const done = await broll(a, project.id);
    expect(done).toMatchObject({ status: "ready", overlays: [], warnings: ["no_broll_shots"] });
  });

  it("empty stock result skips the beat", async () => {
    let n = 0;
    const stock = new FakeStock((_q, { media }) => (n++ < 2 ? [] : media === "image" ? [IMG1] : [VID1]));
    const deps = makeTestDeps({ stock });
    const { a, project } = await plannedProject(deps);
    const done = await broll(a, project.id);
    expect(stock.calls.slice(0, 2).map((c) => c.query)).toEqual(["stock smoothie.", "smoothie. You don t."]); // query, then the intent
    expect(done.warnings).toEqual(["broll_not_found:beat-0"]);
    expect(done.overlays.map((o) => o.shotId)).toEqual(["shot-2"]);
  });

  it("missing provider fails before changing the project", async () => {
    const deps = makeTestDeps({ stock: null });
    const { a, project } = await plannedProject(deps);
    expect((await request(a).post(`/api/projects/${project.id}/broll`).send({})).status).toBe(202);
    expect((await untilJob(a, project.id, "FAILED")).error).toBe("stock_unavailable");
    const after = await get(a, project.id);
    expect(after).toMatchObject({ status: "ready", overlays: [], outputs: project.outputs });
  });

  it("refresh keeps matching overlays and regenerate replaces them", async () => {
    const { a, project } = await plannedProject(makeTestDeps());
    const first = await broll(a, project.id);
    const again = await broll(a, project.id);
    expect(again.overlays.map((o) => [o.id, o.assetId])).toEqual(first.overlays.map((o) => [o.id, o.assetId]));
    const fresh = await broll(a, project.id, { regenerate: true });
    expect(fresh.overlays.map((o) => o.id)).toEqual(["ov-2", "ov-3"]);
    expect(fresh.overlays.map((o) => o.assetId)).not.toEqual(first.overlays.map((o) => o.assetId));
  });

  it("regenerate one overlay asks for page 2 and skips the current result", async () => {
    const deps = makeTestDeps();
    const { a, project } = await plannedProject(deps);
    const first = await broll(a, project.id);
    const next = await broll(a, project.id, { overlayId: "ov-0" });
    expect((deps.stock as FakeStock).calls.at(-1)!.opts.page).toBe(2);
    expect(next.overlays[0]).toMatchObject({ id: "ov-0", attribution: IMG2.attribution });
    expect(next.overlays[0].assetId).not.toBe(first.overlays[0].assetId);
    expect(next.overlays[1]).toEqual(first.overlays[1]);
  });

  it("a re-plan hides overlays until the next b-roll run", async () => {
    const deps = makeTestDeps();
    const { a, project } = await plannedProject(deps);
    await broll(a, project.id);
    await act(a, project.id, [{ type: "setShotKind", shotId: "shot-2", kind: "Talking Head" }], true);
    expect((deps.renderer as FakeRenderer).calls.at(-1)!.inputProps.overlays.map((o) => o.id)).toEqual(["ov-0"]);
    expect(staleOverlays(await get(a, project.id))).toEqual(["ov-1"]);
    const refreshed = await broll(a, project.id);
    expect(refreshed.overlays.map((o) => o.shotId)).toEqual(["shot-1"]);
  });

  it("a re-plan that moves a b-roll shot hides its overlay until the next b-roll run", async () => {
    const deps = makeTestDeps();
    const { a, project } = await plannedProject(deps);
    const done = await broll(a, project.id);
    // What run_job plan leaves behind when new shots reuse the ids at other times.
    const shots = done.editPlan!.shots.map((s) => (s.id === "shot-2" ? { ...s, startMs: s.startMs + 3000 } : s.id === "shot-1" ? { ...s, endMs: s.endMs + 3000 } : s));
    await deps.projects.update(project.id, { editPlan: { ...done.editPlan!, shots } });
    await act(a, project.id, [{ type: "setTitle", title: "re-planned" }], true);
    await request(a).post(`/api/projects/${project.id}/render`).send({});
    await untilJob(a, project.id, "COMPLETE");
    expect((deps.renderer as FakeRenderer).calls.at(-1)!.inputProps.overlays.map((o) => o.id)).toEqual(["ov-0"]);
    expect(staleOverlays(await get(a, project.id))).toEqual(["ov-1"]);
    const refreshed = await broll(a, project.id);
    expect(refreshed.overlays.find((o) => o.shotId === "shot-2")!.startMs).toBe(shots[2].startMs + 300);
  });

  it("re-run clears overlays", async () => {
    const deps = makeTestDeps();
    const { a, project } = await plannedProject(deps);
    await broll(a, project.id);
    const mg = { id: "mg-0", name: "x", code: "c", compiled: "c", startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: [], enabled: true };
    await deps.projects.update(project.id, { motionGraphics: [mg] });
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    await untilJob(a, project.id, "COMPLETE");
    const after = await untilStatus(a, project.id, "ready");
    expect(after.overlays).toEqual([]);
    expect(after.motionGraphics).toEqual([mg]);
  });

  it("route validation", async () => {
    const deps = makeTestDeps();
    const { a, project: bare } = await readyProject(deps);
    expect((await request(a).post(`/api/projects/${bare.id}/broll`).send({})).body).toEqual({ error: "no_plan" });
    const { project } = await plannedProject(deps);
    expect((await request(a).post(`/api/projects/${project.id}/broll`).send({ overlayId: "ov-9" })).body).toEqual({ error: "unknown_id", id: "ov-9" });
    expect((await request(a).post(`/api/projects/${project.id}/broll`).send({ regenerate: "yes" })).status).toBe(400);
    expect((await request(a).post(`/api/projects/${project.id}/broll`).send({})).status).toBe(202);
    expect((await request(a).post(`/api/projects/${project.id}/broll`).send({})).status).toBe(409);
    expect((await request(a).post("/api/projects/nope/broll").send({})).status).toBe(404);
  });
});
