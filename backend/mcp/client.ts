import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { z } from "zod";
import { ACTOR_HEADER, MG_PROBLEMS_HEADER, MgProblemSchema, api } from "../../shared/contract";
import type { ApplyActionsInput, ApplyActionsResult, Asset, BrollInput, Catalog, GenerateInput, JobState, PlanInput, Project, RenderInput } from "../../shared/types";

export class SabiUnreachable extends Error {
  constructor(readonly baseUrl: string) { super(`Sabi API not reachable at ${baseUrl}`); }
}
// The API is up but slow (warming the renderer, a busy event loop): wait and retry, don't tell the user to start it.
export class SabiTimeout extends Error {
  constructor(readonly baseUrl: string, readonly timeoutMs: number) { super(`Sabi API did not answer in ${timeoutMs} ms at ${baseUrl}`); }
}
export class SabiHttpError extends Error {
  constructor(readonly status: number, readonly body: { error?: string; [k: string]: unknown }) { super(`${status} ${body.error ?? "error"}`); }
}

// Renders and uploads legitimately take long (first Remotion bundle ≈ 1 min); everything else must answer fast.
const SLOW_MS = 300_000;

// Thin HTTP client of the running API (never an in-process import): works against dev:lite and dev:server alike.
const mgProblems = (raw: string | null) => {
  try {
    const r = z.array(MgProblemSchema).safeParse(JSON.parse(raw ?? "[]"));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
};

export class SabiApi {
  private timeoutMs: number;
  constructor(readonly baseUrl: string, { timeoutMs = 2000 }: { timeoutMs?: number } = {}) { this.timeoutMs = timeoutMs; }

  private async req(path: string, init: RequestInit & { timeoutMs?: number | null } = {}) {
    const { timeoutMs = this.timeoutMs, headers, ...rest } = init;
    let res: Response;
    try {
      // Every request says it is the agent: the ledger attributes spend to "agent" (attribution, not auth).
      res = await fetch(this.baseUrl + path, { ...rest, headers: { ...(headers as Record<string, string>), [ACTOR_HEADER]: "agent" }, signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined });
    } catch (err) {
      throw timeoutMs && (err as Error).name === "TimeoutError" ? new SabiTimeout(this.baseUrl, timeoutMs) : new SabiUnreachable(this.baseUrl);
    }
    if (!res.ok) throw new SabiHttpError(res.status, await res.json().catch(() => ({ error: res.statusText })));
    return res;
  }
  private async json<T>(path: string, method = "GET", body?: unknown, timeoutMs?: number): Promise<T> {
    const res = await this.req(path, { method, timeoutMs, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return res.json() as Promise<T>;
  }

  listProjects() { return this.json<Project[]>(api.projects); }
  getProject(id: string) { return this.json<Project>(api.project(id)); }
  getJob(id: string) { return this.json<JobState | null>(api.projectJob(id)); }
  createProject(title: string) { return this.json<Project>(api.projects, "POST", { title }); }
  setSource(id: string, assetId: string) { return this.json<Project>(api.projectSource(id), "POST", { assetId }); }
  applyActions(id: string, input: ApplyActionsInput) { return this.json<ApplyActionsResult>(api.projectActions(id), "POST", input); }
  run(id: string, input: { language?: string } = {}) { return this.json<{ jobId: string }>(api.projectRun(id), "POST", input); }
  plan(id: string, input: PlanInput) { return this.json<{ jobId: string }>(api.projectPlan(id), "POST", input); }
  render(id: string, input: RenderInput = {}) { return this.json<{ jobId: string }>(api.projectRender(id), "POST", input); }
  broll(id: string, input: BrollInput) { return this.json<{ jobId: string }>(api.projectBroll(id), "POST", input); }
  generate(id: string, input: GenerateInput) { return this.json<{ jobId: string }>(api.projectGenerate(id), "POST", input); }
  getJobById(id: string, jobId: string) { return this.json<JobState>(`${api.projectJob(id)}?id=${encodeURIComponent(jobId)}`); }
  listAssets(id: string) { return this.json<Asset[]>(api.projectAssets(id)); }
  catalog() { return this.json<Catalog>(api.catalog); }
  async assetBytes(assetId: string) { return Buffer.from(await (await this.req(api.assetFile(assetId), { timeoutMs: SLOW_MS })).arrayBuffer()); }

  // The API clamps t and w; the headers carry the time actually drawn and what its motion graphics reported.
  async frame(id: string, t: number, w: number) {
    const res = await this.req(`${api.projectFrame(id)}?t=${Math.round(t)}&w=${Math.round(w)}`, { timeoutMs: SLOW_MS });
    return { data: Buffer.from(await res.arrayBuffer()), ms: Number(res.headers.get("x-sabi-frame-ms")), problems: mgProblems(res.headers.get(MG_PROBLEMS_HEADER)) };
  }

  // start → PUT (streamed) → done, through the same routes and limits as the browser upload.
  async uploadFile(path: string, mimeType: string, projectId: string) {
    const { size } = await stat(path);
    const { uploadId } = await this.json<{ uploadId: string }>(api.uploadsStart, "POST", { fileName: path.split("/").at(-1), mimeType, sizeBytes: size });
    await this.req(api.upload(uploadId), {
      method: "PUT", headers: { "content-type": mimeType, "content-length": String(size) }, timeoutMs: SLOW_MS,
      body: Readable.toWeb(createReadStream(path)) as unknown as BodyInit, duplex: "half",
    } as RequestInit);
    return this.json<Asset>(api.uploadDone(uploadId), "POST", { projectId }, SLOW_MS);
  }

  // Streams to disk (renders can be large); "wx" refuses an existing file or symlink at outPath.
  async downloadAsset(id: string, outPath: string) {
    const res = await this.req(api.assetFile(id), { timeoutMs: SLOW_MS });
    await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(outPath, { flags: "wx" }));
  }
}
