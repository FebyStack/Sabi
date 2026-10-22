import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebStream } from "node:stream/web";
import type { Asset, AssetMeta, OverlayMedia } from "../../shared/types";
import type { AppDeps } from "./deps";
import { MAX_IMAGE_PX, type MediaInfo } from "./media";
import { limitBytes } from "./streams";

export const MAX_REMOTE_BYTES = 50 * 1024 ** 2;
const TYPES: Record<OverlayMedia, Record<string, string>> = {
  image: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" },
  video: { "video/mp4": ".mp4" },
};

const isHttps = (url: string) => { try { return new URL(url).protocol === "https:"; } catch { return false; } };

// Stock/generated media is untrusted: https only, capped, typed, probed. It is copied into storage so renders never fetch third-party hosts.
export async function importRemote(
  deps: Pick<AppDeps, "storage" | "media" | "id" | "fetch">, url: string, opts: { expect: OverlayMedia; maxBytes?: number },
): Promise<{ key: string; mimeType: string; info: MediaInfo }> {
  const bad = () => new Error("bad_remote_media");
  const max = opts.maxBytes ?? MAX_REMOTE_BYTES;
  if (!isHttps(url)) throw bad();
  const res = await deps.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) }).catch(() => { throw bad(); });
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = TYPES[opts.expect][mimeType];
  if (!res.ok || !res.body || (res.url && !isHttps(res.url)) || !ext || Number(res.headers.get("content-length") ?? 0) > max) {
    await res.body?.cancel().catch(() => {});
    throw bad();
  }
  const name = `${deps.id()}${ext}`;
  const key = `broll/${name}`;
  const work = deps.storage.workPath(`imports/${name}`); // checked locally, stored only once it passes
  try {
    const src = Readable.fromWeb(res.body as WebStream<Uint8Array>);
    const limited = limitBytes(max);
    src.on("error", (err) => limited.destroy(err)); // .pipe() does not forward a dropped connection
    await pipeline(src.pipe(limited), createWriteStream(work));
    const info = await deps.media.probe(work, opts.expect === "image" ? "image" : "av");
    if (!info.width || !info.height || (opts.expect === "image" && Math.max(info.width, info.height) > MAX_IMAGE_PX)) throw bad();
    await deps.storage.put(key, work);
    return { key, mimeType, info };
  } catch {
    await rm(work, { force: true });
    throw bad();
  }
}

// importRemote + the asset row, with where it came from (stock attribution, or the generation and its prompt).
export async function importAsAsset(
  deps: Pick<AppDeps, "storage" | "media" | "id" | "fetch" | "assets" | "now">, req: { projectId: string; url: string; media: OverlayMedia; meta: AssetMeta },
): Promise<Asset> {
  const { key, mimeType, info } = await importRemote(deps, req.url, { expect: req.media });
  const stored = await deps.storage.stat(key);
  return deps.assets.create({
    id: deps.id(), projectId: req.projectId, kind: req.media, key, mimeType, sizeBytes: stored?.size ?? 0, width: info.width, height: info.height,
    ...(req.media === "video" ? { durationMs: info.durationMs } : {}), meta: req.meta, createdAt: deps.now().toISOString(),
  });
}
