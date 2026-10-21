import { ApplyActionsResult, AssetSchema, ProjectSchema, api } from "@shared/contract";
import type { ApplyActionsInput, Asset, BrollInput, PlanInput } from "@shared/types";
import { json } from "@/services/http";

export const getProject = (id: string) => json<unknown>(api.project(id)).then(ProjectSchema.parse);
export const setSource = (id: string, assetId: string) =>
  json<unknown>(api.projectSource(id), { method: "POST", body: JSON.stringify({ assetId }) }).then(ProjectSchema.parse);
export const runProject = (id: string, language?: string) =>
  json<{ jobId: string }>(api.projectRun(id), { method: "POST", body: JSON.stringify(language ? { language } : {}) });
export const planProject = (id: string, input: PlanInput) =>
  json<{ jobId: string }>(api.projectPlan(id), { method: "POST", body: JSON.stringify(input) });
export const addBroll = (id: string, input: BrollInput) =>
  json<{ jobId: string }>(api.projectBroll(id), { method: "POST", body: JSON.stringify(input) });
// Same write path as the editing agent; a 409 stale (someone else edited first) rejects with Error("stale").
export const applyProjectActions = (id: string, input: ApplyActionsInput) =>
  json<unknown>(api.projectActions(id), { method: "POST", body: JSON.stringify(input) }).then(ApplyActionsResult.parse);
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
