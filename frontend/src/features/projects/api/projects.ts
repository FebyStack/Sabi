import { ApplyActionsResult, AssetSchema, ProjectSchema, api } from "@shared/contract";
import type { ApplyActionsInput, Asset, BrollInput, GenerateInput, PlanInput, RenderInput } from "@shared/types";
import { json } from "@/services/http";

export const getProject = (id: string) => json<unknown>(api.project(id)).then(ProjectSchema.parse);
export const setSource = (id: string, assetId: string) =>
  json<unknown>(api.projectSource(id), { method: "POST", body: JSON.stringify({ assetId }) }).then(ProjectSchema.parse);
// language: a code forces it, null re-detects, undefined keeps the project's last language.
export const runProject = (id: string, language?: string | null) =>
  json<{ jobId: string }>(api.projectRun(id), { method: "POST", body: JSON.stringify(language === undefined ? {} : { language }) });
export const planProject = (id: string, input: PlanInput) =>
  json<{ jobId: string }>(api.projectPlan(id), { method: "POST", body: JSON.stringify(input) });
export const addBroll = (id: string, input: BrollInput) =>
  json<{ jobId: string }>(api.projectBroll(id), { method: "POST", body: JSON.stringify(input) });
// One asset on demand; with overlayId the job swaps it into that overlay (no render). 402 over_cap rejects with Error("over_cap").
export const generateAsset = (id: string, input: GenerateInput) =>
  json<{ jobId: string }>(api.projectGenerate(id), { method: "POST", body: JSON.stringify(input) });
// Same write path as the editing agent; a 409 stale (someone else edited first) rejects with Error("stale").
export const applyProjectActions = (id: string, input: ApplyActionsInput) =>
  json<unknown>(api.projectActions(id), { method: "POST", body: JSON.stringify(input) }).then(ApplyActionsResult.parse);
// The explicit export: 1080p (scale 1) or 4K (scale 2).
export const renderProject = (id: string, input: RenderInput) =>
  json<{ jobId: string }>(api.projectRender(id), { method: "POST", body: JSON.stringify(input) });
export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(api.project(id), { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `DELETE → ${res.status}`);
}
export const assetFileUrl = (assetId: string) => api.assetFile(assetId);

// start → PUT bytes (XHR for progress) → done
export async function uploadFile(file: File, onProgress: (pct: number) => void, projectId?: string): Promise<Asset> {
  const { uploadId } = await json<{ uploadId: string }>(api.uploadsStart, {
    method: "POST", body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", api.upload(uploadId));
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(file);
  });
  return json<unknown>(api.uploadDone(uploadId), { method: "POST", body: JSON.stringify(projectId ? { projectId } : {}) }).then(AssetSchema.parse);
}
