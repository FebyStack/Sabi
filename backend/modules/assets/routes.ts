import { Router } from "express";
import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
// stream.compose exists since Node 19 but @types/node@22 still lacks it.
const { compose } = (await import("node:stream")) as unknown as { compose: (...streams: NodeJS.ReadableStream[]) => import("node:stream").Duplex };
import { MAX_CLIP_MS, UPLOAD_LIMITS, UploadStartInput, api } from "../../../shared/contract";
import type { Asset } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";
import { MAX_IMAGE_PX } from "../../shared/media";
import { projectLoader } from "../../shared/routes";
import { TooLarge, limitBytes } from "../../shared/streams";

const kindOf = (mime: string): Asset["kind"] => (mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "image");
// Extension comes from the validated mime type, never from the client file name.
const EXT: Record<string, string> = { "video/mp4": ".mp4", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/wav": ".wav", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

export function assetsRouter(deps: AppDeps) {
  const r = Router();
  // Bytes land in a local work file; done() checks them and only then moves them into storage under `key`.
  const pending = new Map<string, { fileName: string; mimeType: string; sizeBytes: number; key: string; work: string; writing: boolean }>();

  r.post(api.uploadsStart, (req, res) => {
    const parsed = UploadStartInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
    const { fileName, mimeType, sizeBytes } = parsed.data;
    if (sizeBytes > (kindOf(mimeType) === "image" ? UPLOAD_LIMITS.maxImageBytes : UPLOAD_LIMITS.maxBytes)) return res.status(413).json({ error: "too_large" });
    if (!(UPLOAD_LIMITS.mimeTypes as readonly string[]).includes(mimeType)) return res.status(415).json({ error: "unsupported_type" });
    const uploadId = deps.id();
    const name = `${uploadId}${EXT[mimeType]}`;
    pending.set(uploadId, { fileName, mimeType, sizeBytes, key: `uploads/${name}`, work: deps.storage.workPath(`uploads/${name}`), writing: false });
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
      await pipeline(compose(req, limitBytes(up.sizeBytes)), createWriteStream(up.work));
      res.status(204).end();
    } catch (err) {
      await rm(up.work, { force: true });
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
    const local = await stat(up.work).catch(() => null);
    if (!local) { pending.set(req.params.uploadId, up); return res.status(409).json({ error: "no_bytes" }); }
    const kind = kindOf(up.mimeType);
    const info = await deps.media.probe(up.work, kind === "image" ? "image" : "av");
    if (kind === "image" && (!info.width || !info.height || Math.max(info.width, info.height) > MAX_IMAGE_PX)) {
      await rm(up.work, { force: true });
      return res.status(422).json(info.width && info.height ? { error: "too_large_image", maxPx: MAX_IMAGE_PX } : { error: "bad_image" });
    }
    if (info.durationMs > MAX_CLIP_MS) {
      await rm(up.work, { force: true });
      return res.status(422).json({ error: "too_long", maxMs: MAX_CLIP_MS });
    }
    await deps.storage.put(up.key, up.work);
    const asset = await deps.assets.create({
      id: deps.id(), projectId: typeof req.body?.projectId === "string" ? req.body.projectId : null, kind,
      key: up.key, mimeType: up.mimeType, sizeBytes: local.size, ...info, createdAt: deps.now().toISOString(),
    });
    res.status(201).json(asset);
  });

  // Everything stored for one project (source, B-roll candidates with provenance, renders, subtitles); the MCP "assets" section reads it.
  r.get<{ id: string }>(api.projectAssets(":id"), async (req, res) => {
    const project = await projectLoader(deps)(req, res);
    if (project) res.json(await deps.assets.listByProject(project.id));
  });

  // One path for files and buckets: Range is what iOS <video>, the Player and the render browser seek with (206 / 416).
  r.get<{ id: string }>(api.assetFile(":id"), async (req, res) => {
    const asset = await deps.assets.get(req.params.id);
    if (!asset) return res.status(404).json({ error: "not_found" });
    const stored = await deps.storage.stat(asset.key);
    if (!stored) return res.status(404).json({ error: "file_missing" });
    const ranges = req.range(stored.size, { combine: true });
    if (ranges === -1) return res.status(416).set("content-range", `bytes */${stored.size}`).end();
    const range = Array.isArray(ranges) && ranges.type === "bytes" ? ranges[0] : undefined; // no or malformed Range: the whole file
    res.status(range ? 206 : 200).set({
      "content-type": asset.mimeType, "x-content-type-options": "nosniff", "accept-ranges": "bytes",
      "content-length": String(range ? range.end - range.start + 1 : stored.size),
      ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${stored.size}` } : {}),
    });
    const body = await deps.storage.read(asset.key, range);
    if (req.method === "HEAD") { body.destroy(); return res.end(); }
    await pipeline(body, res).catch(() => {}); // a seek aborts the previous request: normal
  });

  return r;
}
