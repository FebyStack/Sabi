import { Readable } from "node:stream";
import type { ReadableStream as WebStream } from "node:stream/web";
import type { OverlayMedia } from "../../shared/types";
import type { AppDeps } from "./deps";
import { MAX_IMAGE_PX, type MediaInfo } from "./media";
import { limitBytes } from "./streams";

export const MAX_REMOTE_BYTES = 50 * 1024 ** 2;
const TYPES: Record<OverlayMedia, Record<string, string>> = {
  image: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" },
  video: { "video/mp4": ".mp4" },
};

const isHttps = (url: string) => { try { return new URL(url).protocol === "https:"; } catch { return false; } };

// Stock/generated media is untrusted: https only, capped, typed, probed. It is copied under DATA_DIR so renders never fetch third-party hosts.
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
  const key = `broll/${deps.id()}${ext}`;
  try {
    const src = Readable.fromWeb(res.body as WebStream<Uint8Array>);
    const limited = limitBytes(max);
    src.on("error", (err) => limited.destroy(err)); // .pipe() does not forward a dropped connection
    await deps.storage.write(key, src.pipe(limited));
    const info = await deps.media.probe(deps.storage.localPath(key), opts.expect === "image" ? "image" : "av");
    if (!info.width || !info.height || (opts.expect === "image" && Math.max(info.width, info.height) > MAX_IMAGE_PX)) throw bad();
    return { key, mimeType, info };
  } catch {
    await deps.storage.remove(key);
    throw bad();
  }
}
