import request from "supertest";
import { createApp } from "../../app/app";
import { FakeMedia } from "../../shared/media";
import type { FakeRenderer } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";
import { FakeTranscriber } from "../../shared/transcriber";
import type { AppDeps } from "../../shared/deps";
import type { Project } from "../../../shared/types";

async function projectWithSource(deps: AppDeps, bytes = "hello") {
  const a = createApp(deps);
  const { body: project } = await request(a).post("/api/projects").send({ title: "t" });
  const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: bytes.length });
  await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from(bytes));
  const { body: asset } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({ projectId: project.id });
  const src = await request(a).post(`/api/projects/${project.id}/source`).send({ assetId: asset.id });
  return { a, project: src.body as Project, asset };
}

const untilStatus = async (a: ReturnType<typeof createApp>, id: string, status: string) => {
  let p: Project | undefined;
  await vi.waitFor(async () => {
    p = (await request(a).get(`/api/projects/${id}`)).body;
    expect(p!.status).toBe(status);
  }, { timeout: 5000 });
  return p!;
};

describe("caption pipeline", () => {
  it("runs upload → ready with three outputs", async () => {
    const deps = makeTestDeps();
    const { a, project } = await projectWithSource(deps);
    expect(project.sourceAssetId).toBeTruthy();
    const run = await request(a).post(`/api/projects/${project.id}/run`).send({});
    expect(run.status).toBe(202);
    expect(run.body.jobId).toBeTruthy();
    const done = await untilStatus(a, project.id, "ready");
    expect(done.phrases.length).toBeGreaterThan(0);
    expect(done.transcript?.words).toHaveLength(58);
    expect(done.outputs.mp4AssetId && done.outputs.srtAssetId && done.outputs.vttAssetId).toBeTruthy();
    const srt = await request(a).get(`/api/assets/${done.outputs.srtAssetId}/file`);
    expect(srt.text.startsWith("1\n00:00:00,040")).toBe(true);
    const mp4 = await request(a).get(`/api/assets/${done.outputs.mp4AssetId}/file`);
    expect(mp4.headers["content-type"]).toContain("video/mp4");
  });

  it("source sets aspect ratio from probe", async () => {
    const { project } = await projectWithSource(makeTestDeps({ media: new FakeMedia({ durationMs: 5000, width: 1920, height: 1080 }) }));
    expect(project.aspectRatio).toBe("16:9");
  });

  it("run without source returns 400", async () => {
    const a = createApp(makeTestDeps());
    const { body: project } = await request(a).post("/api/projects").send({ title: "t" });
    expect((await request(a).post(`/api/projects/${project.id}/run`).send({})).status).toBe(400);
  });

  it("run while busy returns 409", async () => {
    const deps = makeTestDeps();
    let release!: () => void;
    deps.transcriber = { transcribe: () => new Promise<void>((r) => { release = r; }).then(() => ({ language: "en", words: [] })) };
    const { a, project } = await projectWithSource(deps);
    expect((await request(a).post(`/api/projects/${project.id}/run`).send({})).status).toBe(202);
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); // job reached the transcribe stage
    expect(deps.jobs.active(project.id)).not.toBeNull();
    expect((await request(a).post(`/api/projects/${project.id}/run`).send({})).status).toBe(409);
    release();
    await untilStatus(a, project.id, "ready");
  });

  it("transcriber failure marks project failed", async () => {
    const deps = makeTestDeps({ transcriber: { transcribe: async () => { throw new Error("transcriber_unavailable"); } } });
    const { a, project } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    const failed = await untilStatus(a, project.id, "failed");
    expect(failed.status).toBe("failed");
  });

  it("pipeline marks no_speech", async () => {
    const deps = makeTestDeps({ transcriber: new FakeTranscriber({ language: "en", words: [] }) });
    const { a, project } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    const done = await untilStatus(a, project.id, "ready");
    expect(done.phrases).toEqual([]);
    expect(done.warnings).toEqual(["no_speech"]);
    const vtt = await request(a).get(`/api/assets/${done.outputs.vttAssetId}/file`);
    expect(vtt.text).toBe("WEBVTT\n");
  });

  it("phrase edit re-renders without transcribing", async () => {
    const deps = makeTestDeps();
    const fake = deps.transcriber as FakeTranscriber;
    const { a, project } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    const done = await untilStatus(a, project.id, "ready");
    const edited = done.phrases.map((p, i) => (i === 0 ? { ...p, words: p.words.map((w, j) => (j === 0 ? { ...w, text: "HERE" } : w)) } : p));
    const res = await request(a).put(`/api/projects/${project.id}/phrases`).send({ phrases: edited });
    expect(res.status).toBe(202);
    await vi.waitFor(async () => {
      const p: Project = (await request(a).get(`/api/projects/${project.id}`)).body;
      expect(p.status).toBe("ready");
      expect(p.outputs.mp4AssetId).not.toBe(done.outputs.mp4AssetId);
    }, { timeout: 5000 });
    const after: Project = (await request(a).get(`/api/projects/${project.id}`)).body;
    expect(after.phrases[0].words[0].text).toBe("HERE");
    expect(fake.calls).toBe(1);
  });

  it("template change keeps phrase spelling edits", async () => {
    const deps = makeTestDeps();
    const { a, project } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    const done = await untilStatus(a, project.id, "ready");
    const edited = done.phrases.map((p, i) => (i === 0 ? { ...p, words: p.words.map((w, j) => (j === 0 ? { ...w, text: "HERE" } : w)) } : p));
    await request(a).put(`/api/projects/${project.id}/phrases`).send({ phrases: edited });
    await vi.waitFor(async () => expect((await request(a).get(`/api/projects/${project.id}`)).body.outputs.mp4AssetId).not.toBe(done.outputs.mp4AssetId));
    await request(a).put(`/api/projects/${project.id}/template`).send({ captionTemplateId: "bold" });
    await vi.waitFor(async () => {
      const p: Project = (await request(a).get(`/api/projects/${project.id}`)).body;
      expect(p.captionTemplateId).toBe("bold");
      expect(p.status).toBe("ready");
      expect(p.phrases.flatMap((x) => x.words)[0].text).toBe("HERE");
    }, { timeout: 5000 });
  });

  it("template change before any run saves without starting a job", async () => {
    const deps = makeTestDeps();
    const { a, project } = await projectWithSource(deps);
    const res = await request(a).put(`/api/projects/${project.id}/template`).send({ captionTemplateId: "bold" });
    expect(res.status).toBe(200);
    expect(res.body.captionTemplateId).toBe("bold");
    expect(deps.jobs.active(project.id)).toBeNull();
    expect((await request(a).get(`/api/projects/${project.id}`)).body.status).toBe("draft");
  });

  it("renders audio-only sources with sourceKind audio", async () => {
    const deps = makeTestDeps();
    const a = createApp(deps);
    const { body: project } = await request(a).post("/api/projects").send({ title: "t" });
    const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "v.wav", mimeType: "audio/wav", sizeBytes: 5 });
    await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "audio/wav").send(Buffer.from("hello"));
    const { body: asset } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({});
    await request(a).post(`/api/projects/${project.id}/source`).send({ assetId: asset.id });
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    await untilStatus(a, project.id, "ready");
    const renderer = deps.renderer as FakeRenderer;
    expect(renderer.calls.at(-1)?.inputProps.sourceKind).toBe("audio");
  });

  it("rejects phrases with no words", async () => {
    const deps = makeTestDeps();
    const { a, project } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    const done = await untilStatus(a, project.id, "ready");
    const res = await request(a).put(`/api/projects/${project.id}/phrases`).send({ phrases: [{ ...done.phrases[0], words: [] }] });
    expect(res.status).toBe(400);
  });

  it("template change re-renders", async () => {
    const deps = makeTestDeps();
    const { a, project } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    await untilStatus(a, project.id, "ready");
    expect((await request(a).put(`/api/projects/${project.id}/template`).send({ captionTemplateId: "bold" })).status).toBe(202);
    await vi.waitFor(async () => {
      const p: Project = (await request(a).get(`/api/projects/${project.id}`)).body;
      expect(p.captionTemplateId).toBe("bold");
      expect(p.status).toBe("ready");
    }, { timeout: 5000 });
  });
});
