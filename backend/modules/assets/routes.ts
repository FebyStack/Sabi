import { Router } from "express";
import { Transform } from "node:stream";
// stream.compose exists since Node 19 but @types/node@22 still lacks it.
const { compose } = (await import("node:stream")) as unknown as { compose: (...streams: NodeJS.ReadableStream[]) => import("node:stream").Duplex };
import { MAX_CLIP_MS, UPLOAD_LIMITS, UploadStartInput, api } from "../../../shared/contract";
import type { Asset } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";

const kindOf = (mime: string): Asset["kind"] => (mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "image");
// Extension comes from the validated mime type, never from the client file name.
const EXT: Record<string, string> = { "video/mp4": ".mp4", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/wav": ".wav", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

class TooLarge extends Error { constructor() { super("too_large"); } }
const limitBytes = (max: number) => {
  let seen = 0;
  return new Transform({ transform(chunk: Buffer, _enc, cb) { seen += chunk.length; cb(seen > max ? new TooLarge() : null, chunk); } });
};

export function assetsRouter(deps: AppDeps) {
  const r = Router();
  const pending = new Map<string, { fileName: string; mimeType: string; sizeBytes: number; key: string; writing: boolean }>();

  r.post(api.uploadsStart, (req, res) => {
    const parsed = UploadStartInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    const { fileName, mimeType, sizeBytes } = parsed.data;
    if (sizeBytes > UPLOAD_LIMITS.maxBytes) return res.status(413).json({ error: "too_large" });
    if (!(UPLOAD_LIMITS.mimeTypes as readonly string[]).includes(mimeType)) return res.status(415).json({ error: "unsupported_type" });
    const uploadId = deps.id();
    pending.set(uploadId, { fileName, mimeType, sizeBytes, key: `uploads/${uploadId}${EXT[mimeType]}`, writing: false });
    res.json({ uploadId });
  });

  r.put<{ uploadId: string }>(api.upload(":uploadId"), async (req, res) => {
    const up = pending.get(req.params.uploadId);
    if (!up) return res.status(404).json({ error: "not_found" });
    if (up.writing) return res.status(409).json({ error: "upload_in_progress" });
    const declared = Number(req.headers["content-length"]);
    if (declared > up.sizeBytes) return res.status(413).json({ error: "too_large" });
    up.writing = true;
    try {
      // compose() ties the request into the pipeline, so a client abort destroys the write and the catch removes the partial file.
      await deps.storage.write(up.key, compose(req, limitBytes(up.sizeBytes)));
      res.status(204).end();
    } catch (err) {
      await deps.storage.remove(up.key);
      if (res.writableEnded || req.destroyed) return;
      if (err instanceof TooLarge) return res.status(413).json({ error: "too_large" });
      throw err;
    } finally {
      up.writing = false;
    }
  });

  r.post<{ uploadId: string }>(api.uploadDone(":uploadId"), async (req, res) => {
    const up = pending.get(req.params.uploadId);
    if (!up) return res.status(404).json({ error: "not_found" });
    if (up.writing) return res.status(409).json({ error: "upload_in_progress" });
    pending.delete(req.params.uploadId); // claim synchronously: no PUT can start between here and the probe
    const stored = await deps.storage.stat(up.key);
    if (!stored) { pending.set(req.params.uploadId, up); return res.status(409).json({ error: "no_bytes" }); }
    const info = await deps.media.probe(deps.storage.localPath(up.key));
    if (info.durationMs > MAX_CLIP_MS) {
      await deps.storage.remove(up.key);
      return res.status(422).json({ error: "too_long", maxMs: MAX_CLIP_MS });
    }
    const asset = await deps.assets.create({
      id: deps.id(), projectId: typeof req.body?.projectId === "string" ? req.body.projectId : null, kind: kindOf(up.mimeType),
      key: up.key, mimeType: up.mimeType, sizeBytes: stored.size, ...info, createdAt: deps.now().toISOString(),
    });
    res.status(201).json(asset);
  });

  r.get<{ id: string }>(api.assetFile(":id"), async (req, res) => {
    const asset = await deps.assets.get(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });
    // sendFile handles Range (iOS <video> needs 206), ETag, and a missing file without crashing the process.
    res.sendFile(deps.storage.localPath(asset.key), { headers: { "content-type": asset.mimeType, "x-content-type-options": "nosniff" } }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "file_missing" });
    });
  });

  return r;
}
