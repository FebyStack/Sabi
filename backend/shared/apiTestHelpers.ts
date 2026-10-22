import request from "supertest";
import { createApp } from "../app/app";
import type { Project } from "../../shared/types";
import type { AppDeps } from "./deps";

// Shared by the API tests (vitest globals); never imported by the server.
export async function projectWithSource(deps: AppDeps, bytes = "hello") {
  const a = createApp(deps);
  const { body: project } = await request(a).post("/api/projects").send({ title: "t" });
  const { body: { uploadId } } = await request(a).post("/api/assets/uploads/start").send({ fileName: "c.mp4", mimeType: "video/mp4", sizeBytes: bytes.length });
  await request(a).put(`/api/assets/uploads/${uploadId}`).set("content-type", "video/mp4").send(Buffer.from(bytes));
  const { body: asset } = await request(a).post(`/api/assets/uploads/${uploadId}/done`).send({ projectId: project.id });
  const src = await request(a).post(`/api/projects/${project.id}/source`).send({ assetId: asset.id });
  return { a, project: src.body as Project, asset };
}

export const untilStatus = async (a: ReturnType<typeof createApp>, id: string, status: string) => {
  let p: Project | undefined;
  await vi.waitFor(async () => {
    p = (await request(a).get(`/api/projects/${id}`)).body;
    expect(p!.status).toBe(status);
  }, { timeout: 5000 });
  return p!;
};

export async function readyProject(deps: AppDeps) {
  const { a, project } = await projectWithSource(deps);
  await request(a).post(`/api/projects/${project.id}/run`).send({});
  return { a, project: await untilStatus(a, project.id, "ready") };
}

// Keeps a job of `kind` running (or queued behind another) for `projectId` until the returned release() is called.
const holds = new Map<string, Promise<void>>();
export async function holdJob(deps: AppDeps, projectId: string, opts: { kind?: string; progress?: number; stage?: string } = {}) {
  let release!: () => void;
  holds.set(projectId, new Promise<void>((r) => { release = r; }));
  deps.jobs.handle(opts.kind ?? "hold", async ({ projectId: id, report }) => {
    if (opts.progress !== undefined) report(opts.progress, opts.stage);
    await holds.get(id);
  });
  await deps.jobs.enqueue(projectId, opts.kind ?? "hold", { input: {}, actor: "web", prevStatus: "ready" });
  return release;
}

// readyProject → plan (fake: shot-1 becomes "Talking Head & B-Roll") → a stock B-roll run: overlays ov-0 (shot-1) and ov-1 (shot-2).
export async function brollProject(deps: AppDeps) {
  const { a, project } = await readyProject(deps);
  await request(a).post(`/api/projects/${project.id}/plan`).send({});
  const planned = await untilStatus(a, project.id, "ready").then(async () => (await request(a).get(`/api/projects/${project.id}`)).body as Project);
  await request(a).post(`/api/projects/${project.id}/actions`).send({ baseVersion: planned.updatedAt, actions: [
    { type: "setShotKind", shotId: "shot-1", kind: "Talking Head & B-Roll" }, { type: "setMediaSource", mediaSource: "stock" }] });
  await request(a).post(`/api/projects/${project.id}/broll`).send({});
  await vi.waitFor(async () => expect((await request(a).get(`/api/projects/${project.id}`)).body.overlays).toHaveLength(2), { timeout: 5000 });
  return { a, project: await untilStatus(a, project.id, "ready") };
}
