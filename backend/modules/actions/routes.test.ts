import request from "supertest";
import { readyProject, untilStatus } from "../../shared/apiTestHelpers";
import { PNG_1x1_BASE64 } from "../../shared/renderer";
import { FakeRenderer } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";
import type { Project, ProjectEvent } from "../../../shared/types";

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

  it("tells open browser tabs about an unrendered edit", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const events: ProjectEvent[] = [];
    deps.bus.subscribe(project.id, (e) => events.push(e));
    await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "x" }] });
    expect(events).toEqual([{ type: "project", status: "ready" }]); // the UI refetches on project events
  });

  it("stale baseVersion rejects the whole batch", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    await new Promise((r) => setTimeout(r, 5)); // updatedAt has millisecond resolution
    const web = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, actions: [{ type: "editPhrase", phraseId: project.phrases[0].id, text: "web" }] });
    expect(web.status).toBe(200);
    const edited: Project = web.body.project;
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({
      baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "agent" }, { type: "editPhrase", phraseId: project.phrases[0].id, text: "agent text" }],
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "stale", currentVersion: edited.updatedAt });
    const after: Project = (await request(a).get(`/api/projects/${project.id}`)).body;
    expect(after.title).toBe("t");
    expect(after.phrases).toEqual(edited.phrases);
  });

  it("a web edit landing between load and write still wins", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const get = deps.projects.get.bind(deps.projects);
    let raced = false;
    deps.projects.get = async (id) => {
      const snapshot = await get(id);
      if (!raced) { raced = true; await new Promise((r) => setTimeout(r, 5)); await deps.projects.update(id, { title: "web" }); }
      return snapshot; // the route now holds a stale copy whose version still equals baseVersion
    };
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "agent" }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("stale");
    expect((await get(project.id))!.title).toBe("web");
  });

  it("an action without render marks outputs stale", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const cut = project.phrases[0];
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, render: false, actions: [{ type: "editPhrase", phraseId: cut.id, text: "Fresh words" }] });
    expect(res.body.project.outputs).toEqual({ ...project.outputs, stale: true });
    expect((await request(a).post(`/api/projects/${project.id}/render`).send({})).status).toBe(202);
    const done = await untilStatus(a, project.id, "ready");
    expect(done.outputs.stale).toBeUndefined();
    expect(done.outputs.mp4AssetId).not.toBe(project.outputs.mp4AssetId);
  });

  it("title edits do not mark outputs stale", async () => {
    const { a, project } = await readyProject(makeTestDeps());
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "x" }, { type: "setMediaSource", mediaSource: "stock" }] });
    expect(res.body.project.outputs).toEqual(project.outputs);
  });

  it("setCut with render re-renders at full length", async () => {
    const deps = makeTestDeps();
    const { a, project: ready } = await readyProject(deps);
    await request(a).post(`/api/projects/${ready.id}/plan`).send({});
    const project = await vi.waitFor(async () => {
      const p: Project = (await request(a).get(`/api/projects/${ready.id}`)).body;
      expect(p.status === "ready" && p.editPlan).toBeTruthy();
      return p;
    });
    const trailing = project.editPlan!.cuts.find((c) => c.endMs === 21000)!;
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, render: true, actions: [{ type: "setCut", cutId: trailing.id, shouldTrim: false }] });
    expect(res.status).toBe(202);
    await untilStatus(a, project.id, "ready");
    expect((deps.renderer as FakeRenderer).calls.at(-1)!.durationMs).toBe(21000);
  });

  it("a template action keeps phrase spelling edits", async () => {
    const { a, project } = await readyProject(makeTestDeps());
    const first = project.phrases[0];
    const text = ["HERE", ...first.words.slice(1).map((w) => w.text)].join(" ");
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: project.updatedAt, actions: [
      { type: "editPhrase", phraseId: first.id, text }, { type: "setTemplate", captionTemplateId: "bold" },
    ] });
    expect(res.body.project.captionTemplateId).toBe("bold");
    expect(res.body.project.phrases[0].words[0].text).toBe("HERE");
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

  it("looks up assets referenced by actions", async () => {
    const deps = makeTestDeps();
    const { a, project } = await readyProject(deps);
    const overlay = {
      id: "ov-0", shotId: "shot-x", assetId: "old", media: "image" as const, source: "stock" as const, startMs: 300, endMs: 2300, placement: "full" as const,
      transition: "fade" as const, enabled: true, query: "q", prompt: "p", intent: "i", attribution: { author: "A", url: "https://www.pexels.com/photo/1" },
    };
    const seeded = await deps.projects.update(project.id, { overlays: [overlay] });
    const png = Buffer.from(PNG_1x1_BASE64, "base64");
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "p.png", mimeType: "image/png", sizeBytes: png.length });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "image/png").send(png);
    const { body: img } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({ projectId: project.id });
    const bad = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: seeded.updatedAt, actions: [{ type: "replaceOverlay", overlayId: "ov-0", assetId: "nope" }] });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "bad_asset", id: "nope" });
    const ok = await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: seeded.updatedAt, actions: [{ type: "replaceOverlay", overlayId: "ov-0", assetId: img.id }] });
    expect(ok.status).toBe(200);
    expect(ok.body.project.overlays[0]).toMatchObject({ assetId: img.id, source: "uploaded" });
  });

  it("bad motion-graphic code is a 400 with detail", async () => {
    const { a, project } = await readyProject(makeTestDeps());
    const res = await request(a).post(`/api/projects/${project.id}/actions`).send({
      baseVersion: project.updatedAt, actions: [{ type: "addMotionGraphic", name: "x", code: "const Component = () => window.x;", startMs: 0, endMs: 1000 }],
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_code", detail: "forbidden: window" });
  });
});
