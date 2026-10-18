import { AssetSchema, ProjectSchema, api } from "@shared/contract";
import type { Asset, Phrase, Project } from "@shared/types";
import { json } from "@/services/http";

export const getProject = (id: string) => json<unknown>(api.project(id)).then(ProjectSchema.parse);
export const setSource = (id: string, assetId: string) =>
  json<unknown>(api.projectSource(id), { method: "POST", body: JSON.stringify({ assetId }) }).then(ProjectSchema.parse);
export const runProject = (id: string, language?: string) =>
  json<{ jobId: string }>(api.projectRun(id), { method: "POST", body: JSON.stringify(language ? { language } : {}) });
export const updatePhrases = (id: string, phrases: Phrase[]) =>
  json<{ jobId: string }>(api.projectPhrases(id), { method: "PUT", body: JSON.stringify({ phrases }) });
export const updateTemplate = (id: string, captionTemplateId: Project["captionTemplateId"]) =>
  json<{ jobId: string }>(api.projectTemplate(id), { method: "PUT", body: JSON.stringify({ captionTemplateId }) });
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
