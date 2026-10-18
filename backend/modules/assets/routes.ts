import { Router } from "express";
import { extname } from "node:path";
import { UPLOAD_LIMITS, UploadStartInput, api } from "../../../shared/contract";
import type { Asset } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";

const kindOf = (mime: string): Asset["kind"] => (mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "image");

export function assetsRouter(deps: AppDeps) {
  const r = Router();
  const pending = new Map<string, { fileName: string; mimeType: string; sizeBytes: number; key: string }>();

  r.post(api.uploadsStart, (req, res) => {
    const parsed = UploadStartInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    const { fileName, mimeType, sizeBytes } = parsed.data;
    if (sizeBytes > UPLOAD_LIMITS.maxBytes) return res.status(413).json({ error: "too_large" });
    if (!(UPLOAD_LIMITS.mimeTypes as readonly string[]).includes(mimeType)) return res.status(415).json({ error: "unsupported_type" });
    const uploadId = deps.id();
    pending.set(uploadId, { fileName, mimeType, sizeBytes, key: `uploads/${uploadId}${extname(fileName).toLowerCase()}` });
    res.json({ uploadId });
  });

  r.put<{ uploadId: string }>(api.upload(":uploadId"), async (req, res) => {
    const up = pending.get(req.params.uploadId);
    if (!up) return res.status(404).json({ error: "not_found" });
    await deps.storage.write(up.key, req); // streamed straight to disk; never buffered
    res.status(204).end();
  });

  r.post<{ uploadId: string }>(api.uploadDone(":uploadId"), async (req, res) => {
    const up = pending.get(req.params.uploadId);
    if (!up) return res.status(404).json({ error: "not_found" });
    const stored = await deps.storage.stat(up.key);
    if (!stored) return res.status(409).json({ error: "no_bytes" });
    const info = await deps.media.probe(deps.storage.localPath(up.key));
    const asset = await deps.assets.create({
      id: deps.id(), projectId: typeof req.body?.projectId === "string" ? req.body.projectId : null, kind: kindOf(up.mimeType),
      key: up.key, mimeType: up.mimeType, sizeBytes: stored.size, ...info, createdAt: deps.now().toISOString(),
    });
    pending.delete(req.params.uploadId);
    res.status(201).json(asset);
  });

  r.get<{ id: string }>(api.assetFile(":id"), async (req, res) => {
    const asset = await deps.assets.get(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });
    res.setHeader("content-type", asset.mimeType);
    res.setHeader("content-length", String(asset.sizeBytes));
    deps.storage.read(asset.key).pipe(res);
  });

  return r;
}
