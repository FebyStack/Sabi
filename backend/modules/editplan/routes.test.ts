import request from "supertest";
import type { createApp } from "../../app/app";
import { projectWithSource, readyProject } from "../../shared/apiTestHelpers";
import { FakeLlm } from "../../shared/llm";
import type { FakeRenderer } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";
import type { Project, ProjectEvent } from "../../../shared/types";

const untilPlanned = async (a: ReturnType<typeof createApp>, id: string) => {
  let p: Project | undefined;
  await vi.waitFor(async () => {
    p = (await request(a).get(`/api/projects/${id}`)).body;
    expect(p!.status).toBe("ready");
    expect(p!.editPlan).toBeTruthy();
  }, { timeout: 5000 });
  return p!;
};

async function planned(body: object = {}) {
  const deps = makeTestDeps();
  const { a, project } = await readyProject(deps);
  await request(a).post(`/api/projects/${project.id}/plan`).send(body);
  return { deps, a, project: await untilPlanned(a, project.id), renderer: deps.renderer as FakeRenderer };
}

describe("edit plan api", () => {
  it("plans, translates and re-renders", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    expect((await request(a).post(`/api/projects/${project.id}/plan`).send({ languages: ["es"], burnInLanguage: "es" })).status).toBe(202);
    const done = await untilPlanned(a, project.id);
    expect(done.editPlan!.cuts).toContainEqual(expect.objectContaining({ reason: "pause", startMs: 17950, endMs: 21000 }));
    expect(done.editPlan!.shots[0]).toMatchObject({ kind: "Hook", startMs: 0 });
    expect(done.phrases[0].emoji).toBe("🔥");
    expect(done.burnInLanguage).toBe("es");
    const es = done.outputs.translations!.find((t) => t.language === "es")!;
    expect((await request(a).get(`/api/assets/${es.srtAssetId}/file`)).text).toContain("Spanish: ");
    expect((deps.renderer as FakeRenderer).calls.at(-1)!.durationMs).toBe(17950);
    expect((await request(a).get(`/api/projects/${project.id}/plan`)).body).toEqual(done.editPlan);
  });

  it("skips a translation into the transcript's own language", async () => {
    const { project } = await planned({ languages: ["en", "es"], burnInLanguage: "en" });
    expect(project.translations.map((t) => t.language)).toEqual(["es"]);
    expect(project.burnInLanguage).toBeNull();
  });

  it("plan failure keeps previous outputs", async () => {
    const deps = makeTestDeps({ llm: new FakeLlm(() => { throw new Error("llm_unavailable"); }) });
    const { a, project } = await readyProject(deps);
    const events: ProjectEvent[] = [];
    deps.bus.subscribe(project.id, (e) => events.push(e));
    expect((await request(a).post(`/api/projects/${project.id}/plan`).send({})).status).toBe(202);
    await vi.waitFor(() => expect(events).toContainEqual({ type: "job", job: expect.objectContaining({ kind: "plan", state: "FAILED", error: "llm_unavailable" }) }));
    const after: Project = (await request(a).get(`/api/projects/${project.id}`)).body;
    expect(after.status).toBe("ready");
    expect(after.outputs.mp4AssetId).toBe(project.outputs.mp4AssetId);
    expect(after.editPlan).toBeNull();
  });

  it("rejects plan without captions", async () => {
    const { a, project } = await projectWithSource(makeTestDeps());
    const res = await request(a).post(`/api/projects/${project.id}/plan`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("no_captions");
    expect((await request(a).get(`/api/projects/${project.id}/plan`)).body.error).toBe("no_plan");
    expect((await request(a).post(`/api/projects/${project.id}/plan`).send({ languages: ["xx"] })).body.error).toBe("invalid_input");
  });

  it("toggling a cut re-renders at full length", async () => {
    const { a, project, renderer } = await planned();
    const trailing = project.editPlan!.cuts.find((c) => c.endMs === 21000)!;
    const calls = renderer.calls.length;
    const res = await request(a).patch(`/api/projects/${project.id}/plan`).send({ cuts: [{ id: trailing.id, shouldTrim: false }] });
    expect(res.status).toBe(202);
    await vi.waitFor(async () => {
      expect(renderer.calls.length).toBe(calls + 1);
      expect((await request(a).get(`/api/projects/${project.id}`)).body.status).toBe("ready");
    });
    expect(renderer.calls.at(-1)!.durationMs).toBe(21000);
    expect((await request(a).get(`/api/projects/${project.id}/plan`)).body.cuts.find((c: { id: string }) => c.id === trailing.id).shouldTrim).toBe(false);
  });

  it("changing only a shot kind saves without rendering", async () => {
    const { a, project, renderer } = await planned();
    const calls = renderer.calls.length;
    const res = await request(a).patch(`/api/projects/${project.id}/plan`).send({ shots: [{ id: "shot-0", kind: "B-Roll" }] });
    expect(res.status).toBe(200);
    expect(res.body.shots[0].kind).toBe("B-Roll");
    expect(renderer.calls.length).toBe(calls);
  });

  it("unknown ids and untranslated burn-in are rejected", async () => {
    const { a, project } = await planned();
    const patch = (body: object) => request(a).patch(`/api/projects/${project.id}/plan`).send(body);
    expect((await patch({ cuts: [{ id: "nope", shouldTrim: false }] })).body).toEqual({ error: "unknown_id" });
    expect((await patch({ shots: [{ id: "shot-0", kind: "B-Roll" }, { id: "nope", kind: "Hook" }] })).body).toEqual({ error: "unknown_id" });
    expect((await patch({ burnInLanguage: "fr" })).body).toEqual({ error: "bad_burn_in" });
    expect((await request(a).get(`/api/projects/${project.id}/plan`)).body).toEqual(project.editPlan);
  });

  it("template change keeps plan data; re-run clears it", async () => {
    const { a, project } = await planned({ languages: ["es"] });
    expect((await request(a).put(`/api/projects/${project.id}/template`).send({ captionTemplateId: "bold" })).status).toBe(202);
    let p: Project | undefined;
    await vi.waitFor(async () => {
      p = (await request(a).get(`/api/projects/${project.id}`)).body;
      expect(p!).toMatchObject({ captionTemplateId: "bold", status: "ready" });
      expect(p!.outputs.mp4AssetId).not.toBe(project.outputs.mp4AssetId);
    });
    expect(p!.phrases[0].emoji).toBe("🔥");
    expect(p!.phrases.flatMap((x) => x.words).filter((w) => w.emphasis).length).toBe(project.phrases.length);
    expect(p!.translations).toHaveLength(1);
    expect(p!.editPlan).toEqual(project.editPlan);

    await request(a).post(`/api/projects/${project.id}/run`).send({});
    await vi.waitFor(async () => {
      p = (await request(a).get(`/api/projects/${project.id}`)).body;
      expect(p!).toMatchObject({ status: "ready", editPlan: null, translations: [], burnInLanguage: null });
    });
  });
});
