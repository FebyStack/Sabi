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
