import request from "supertest";
import { readyProject, untilStatus } from "../../shared/apiTestHelpers";
import { FakeRenderer } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";
import type { Project } from "../../../shared/types";

const text = (p: Project) => p.phrases.flatMap((ph) => ph.words.map((w) => w.text)).join(" ");

describe("actions api", () => {
  it("applies and re-renders", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({
      baseVersion: project.updatedAt, render: true,
      actions: [{ type: "setTitle", title: "Morning" }, { type: "editPhrase", phraseId: project.phrases[0].id, text: "Fixed opening words" }],
    });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ applied: 2, jobId: expect.any(String), project: { title: "Morning" } });
    const done = await untilStatus(a, project.id, "ready");
    expect(done.outputs.mp4AssetId).not.toBe(project.outputs.mp4AssetId);
    expect(text(done)).toContain("Fixed opening words");
    expect(done.title).toBe("Morning");
  });

  it("applies without rendering and returns the new version", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const calls = (deps.renderer as FakeRenderer).calls.length;
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({
      baseVersion: project.updatedAt, actions: [{ type: "setTemplate", captionTemplateId: "bold" }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: 1, project: { captionTemplateId: "bold", status: "ready" } });
    expect(res.body.jobId).toBeUndefined();
    expect((deps.renderer as FakeRenderer).calls.length).toBe(calls);
  });

  it("stale baseVersion rejects the whole batch", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    await new Promise((r) => setTimeout(r, 5)); // updatedAt has millisecond resolution
    const phrases = project.phrases.map((p, i) => (i ? p : { ...p, words: p.words.map((w) => ({ ...w, text: "web" })) }));
    expect((await request(a).put(`/api/projects/${project.id}/phrases`).send({ phrases })).status).toBe(202);
    const edited = await untilStatus(a, project.id, "ready");
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({
      baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "agent" }, { type: "editPhrase", phraseId: project.phrases[0].id, text: "agent text" }],
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "stale", currentVersion: edited.updatedAt });
    const after: Project = (await request(a).get(`/api/projects/${project.id}`)).body;
    expect(after.title).toBe("t");
    expect(after.phrases).toEqual(edited.phrases);
  });

  it("busy is 409", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    deps.jobs.enqueue(project.id, "plan", async () => { await gate; });
    await vi.waitFor(() => expect(deps.jobs.active(project.id)).not.toBeNull());
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "x" }] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "busy", job: { kind: "plan" } });
    expect((await request(a).post(`/api/projects/${project.id}/render`)).status).toBe(409);
    release();
  });

  it("rejects bad input and unknown ids without applying anything", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const post = (body: object) => request(a).post(`/api/projects/${project.id}/actions`).send(body);
    expect((await post({ baseVersion: project.updatedAt, actions: [] })).body.error).toBe("invalid_input");
    expect((await post({ baseVersion: project.updatedAt, actions: Array(51).fill({ type: "setTitle", title: "x" }) })).body.error).toBe("invalid_input");
    const bad = await post({ baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "x" }, { type: "editPhrase", phraseId: "ph-nope", text: "a" }] });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "unknown_id", id: "ph-nope" });
    expect((await request(a).get(`/api/projects/${project.id}`)).body.title).toBe("t");
  });

  it("render endpoint re-renders", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const res = await request(a).post(`/api/projects/${project.id}/render`);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toEqual(expect.any(String));
    const done = await untilStatus(a, project.id, "ready");
    expect(done.outputs.mp4AssetId).not.toBe(project.outputs.mp4AssetId);
    expect(done.phrases).toEqual(project.phrases);
    const fresh = await request(a).post("/api/projects").send({ title: "empty" });
    expect((await request(a).post(`/api/projects/${fresh.body.id}/render`)).body).toEqual({ error: "no_captions" });
  });
});
