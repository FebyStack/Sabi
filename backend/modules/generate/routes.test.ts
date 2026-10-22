import request from "supertest";
import type { createApp } from "../../app/app";
import { brollProject, holdJob, readyProject } from "../../shared/apiTestHelpers";
import { FakeGenerator } from "../../shared/generator";
import { FakeRenderer } from "../../shared/renderer";
import { FakeStock } from "../../shared/stock";
import { IMG1, IMG2, makeTestDeps } from "../../shared/testing";
import type { JobState, Project } from "../../../shared/types";

type App = ReturnType<typeof createApp>;
const get = async (a: App, id: string): Promise<Project> => (await request(a).get(`/api/projects/${id}`)).body;
const generate = async (a: App, id: string, body: object): Promise<JobState> => {
  const res = await request(a).post(`/api/projects/${id}/generate`).send(body);
  expect(res.status).toBe(202);
  let job!: JobState;
  await vi.waitFor(async () => {
    job = (await request(a).get(`/api/projects/${id}/job?id=${res.body.jobId}`)).body;
    expect(["COMPLETE", "FAILED"]).toContain(job.state);
  }, { timeout: 5000 });
  return job;
};
const photo = (n: number) => ({ ...IMG1, attribution: { author: `P${n}`, url: `https://www.pexels.com/photo/${n}` } });

describe("generate api", () => {
  it("generates one image, records it and returns its asset id", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const renders = (deps.renderer as FakeRenderer).calls.length;
    const job = await generate(a, project.id, { source: "generate", media: "image", prompt: "a sunrise over rice fields" });
    expect(job).toMatchObject({ kind: "generate", state: "COMPLETE" });
    expect(job.result?.assetIds).toHaveLength(1);
    expect(await deps.assets.get(job.result!.assetIds[0])).toMatchObject({
      projectId: project.id, kind: "image",
      meta: { source: "generated", prompt: "a sunrise over rice fields", generationInfo: { provider: "fal", model: "fal-ai/flux/schnell", prompt: "a sunrise over rice fields", costCents: 1 } },
    });
    expect((deps.generator as FakeGenerator).calls).toEqual([{ prompt: "a sunrise over rice fields", media: "image", width: 1080, height: 1920 }]);
    expect(await deps.ledger.since(new Date(0))).toMatchObject([{ jobKind: "generate", actor: "web", costCents: 1, projectId: project.id }]);
    const after = await get(a, project.id);
    expect(after.creditsUsedCents).toBe(1);
    expect(after.status).toBe("ready");
    expect(after.outputs.stale).toBeFalsy(); // nothing placed, nothing stale
    expect((deps.renderer as FakeRenderer).calls).toHaveLength(renders); // never renders
  });

  it("a stock query imports up to three candidates, one for an overlay", async () => {
    const stock = new FakeStock(() => [photo(1), photo(2), photo(3), photo(4)]);
    const deps = makeTestDeps({ stock });
    const { a, project } = await readyProject(deps);
    const job = await generate(a, project.id, { source: "stock", media: "image", query: "rice fields" });
    const assets = await Promise.all(job.result!.assetIds.map((id) => deps.assets.get(id)));
    expect(assets.map((x) => x?.meta)).toEqual([1, 2, 3].map((n) => ({ source: "stock", attribution: photo(n).attribution, query: "rice fields" })));
    expect(stock.calls[0]).toEqual({ query: "rice fields", opts: { media: "image", orientation: "portrait" } });
    expect(await deps.ledger.since(new Date(0))).toEqual([]); // Pexels is free and never ledgered
    const { a: a2, project: p2 } = await brollProject(makeTestDeps({ stock }));
    const one = await generate(a2, p2.id, { source: "stock", media: "image", query: "rice fields", overlayId: "ov-1" });
    expect(one.result?.assetIds).toHaveLength(1);
  });

  it("overlayId swaps that overlay and marks the MP4 stale", async () => {
    const deps = makeTestDeps();
    const { a, project } = await brollProject(deps);
    const before = project.overlays.find((o) => o.id === "ov-1")!;
    const job = await generate(a, project.id, { source: "generate", media: "image", prompt: "a kettle on a stove", overlayId: "ov-1" });
    const after = await get(a, project.id);
    const o = after.overlays.find((x) => x.id === "ov-1")!;
    expect(o).toMatchObject({ assetId: job.result!.assetIds[0], source: "generated", prompt: "a kettle on a stove", startMs: before.startMs, endMs: before.endMs, placement: before.placement, query: before.query });
    expect(o.attribution).toBeUndefined();
    expect(after.overlays.find((x) => x.id === "ov-0")).toEqual(project.overlays.find((x) => x.id === "ov-0"));
    expect(after.outputs.stale).toBe(true);
    expect(after.status).toBe("ready");
  });

  it("generate over the cap answers 402 and starts no job", async () => {
    const deps = makeTestDeps({ spendCapCents: 25 });
    const { a, project } = await readyProject(deps);
    await deps.ledger.record({ id: "r", projectId: "x", provider: "fal", model: "fal-ai/flux/schnell", media: "image", costCents: 1, jobKind: "broll", actor: "web", createdAt: "2026-01-01T00:00:00.000Z" });
    const res = await request(a).post(`/api/projects/${project.id}/generate`).send({ source: "generate", media: "video", prompt: "a kettle" });
    expect(res.status).toBe(402);
    expect(res.body).toEqual({ error: "over_cap", monthCents: 1, capCents: 25 });
    expect((await request(a).get(`/api/projects/${project.id}/job`)).body.kind).toBe("captions"); // still the last job
    expect((deps.generator as FakeGenerator).calls).toEqual([]);
    expect((await request(a).post(`/api/projects/${project.id}/generate`).send({ source: "stock", media: "video", query: "kettle" })).status).toBe(202); // stock is free
  });

  it("refusals come in order", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const post = (body: object, id = project.id) => request(a).post(`/api/projects/${id}/generate`).send(body);
    expect((await post({ source: "generate", media: "image" })).body).toMatchObject({ error: "invalid_input" }); // a prompt is required
    expect((await post({ source: "stock", media: "image", prompt: "x" })).status).toBe(400); // stock needs a query
    expect((await post({ source: "generate", media: "image", prompt: "x" }, "nope")).status).toBe(404);
    expect((await post({ source: "generate", media: "image", prompt: "x", overlayId: "ov-9" })).body).toEqual({ error: "unknown_id", id: "ov-9" });
    deps.generator = null;
    expect((await post({ source: "generate", media: "image", prompt: "x" })).body).toEqual({ error: "generator_unavailable" });
    deps.stock = null;
    expect((await post({ source: "stock", media: "image", query: "x" })).status).toBe(503);
    deps.stock = new FakeStock(() => [IMG1]);
    const release = await holdJob(deps, project.id);
    expect((await post({ source: "stock", media: "image", query: "x" })).body).toMatchObject({ error: "busy", job: { kind: "hold" } });
    release();
  });

  it("a stock query with no results fails not_found", async () => {
    const deps = makeTestDeps({ stock: new FakeStock(() => []) });
    const { a, project } = await readyProject(deps);
    expect(await generate(a, project.id, { source: "stock", media: "image", query: "nothing" })).toMatchObject({ state: "FAILED", error: "not_found" });
  });

  it("lists a project's assets with their provenance", async () => {
    const deps = makeTestDeps({ stock: new FakeStock(() => [IMG2]) });
    const { a, project } = await readyProject(deps);
    const job = await generate(a, project.id, { source: "stock", media: "image", query: "kettle" });
    const res = await request(a).get(`/api/projects/${project.id}/assets`);
    expect(res.status).toBe(200);
    expect(res.body.find((x: { id: string }) => x.id === job.result!.assetIds[0])).toMatchObject({ kind: "image", meta: { source: "stock", query: "kettle" } });
    expect(res.body.some((x: { id: string }) => x.id === project.sourceAssetId)).toBe(true);
    expect((await request(a).get("/api/projects/nope/assets")).status).toBe(404);
  });
});
