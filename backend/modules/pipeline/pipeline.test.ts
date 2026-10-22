import request from "supertest";
import { createApp } from "../../app/app";
import { FakeMedia } from "../../shared/media";
import type { FakeRenderer } from "../../shared/renderer";
import { makeTestDeps } from "../../shared/testing";
import { FakeTranscriber } from "../../shared/transcriber";
import { projectWithSource, untilStatus } from "../../shared/apiTestHelpers";
import type { Project } from "../../../shared/types";
import sample from "../../shared/fixtures/transcript-sample.json";

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

  it("source stores the probed duration", async () => {
    const { project } = await projectWithSource(makeTestDeps());
    expect(project.sourceDurationMs).toBe(21000);
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

  it("new source resets the detected language", async () => {
    const deps = makeTestDeps();
    const { a, project, asset } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    expect((await untilStatus(a, project.id, "ready")).language).toBe("en");
    const src = await request(a).post(`/api/projects/${project.id}/source`).send({ assetId: asset.id });
    expect(src.body.language).toBeNull();
  });

  it("run honours an explicit language over the project's", async () => {
    const fake = new FakeTranscriber({ language: "tl", words: sample.words });
    const { a, project } = await projectWithSource(makeTestDeps({ transcriber: fake }));
    const runWith = async (body: object) => {
      await request(a).post(`/api/projects/${project.id}/run`).send(body);
      await untilStatus(a, project.id, "ready");
      return fake.languages.at(-1);
    };
    expect(await runWith({})).toBeUndefined();
    expect(await runWith({ language: "en" })).toBe("en");
    expect(await runWith({})).toBe("tl"); // the stored transcript's language
  });

  it("tl line breaks keep ng with its noun", async () => {
    const words = "Bumili ako kahapon ng isda".split(" ").map((text, i) => ({ id: `w-${i}`, text, startMs: i * 300, endMs: i * 300 + 250 }));
    const { a, project } = await projectWithSource(makeTestDeps({ transcriber: new FakeTranscriber({ language: "tl", words }) }));
    expect(project.captionTemplateId).toBe("clean");
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    const done = await untilStatus(a, project.id, "ready");
    expect(done.phrases[0].lineBreaksAfter).toEqual([2]);
  });

  it("pipeline warns timing_estimated", async () => {
    const deps = makeTestDeps({ transcriber: new FakeTranscriber({ language: "tl", words: sample.words.slice(0, 5), estimatedWords: 2 }) });
    const { a, project } = await projectWithSource(deps);
    await request(a).post(`/api/projects/${project.id}/run`).send({});
    const done = await untilStatus(a, project.id, "ready");
    expect(done.warnings).toEqual(["timing_estimated"]);
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

});
