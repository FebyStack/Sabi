// npm run demo:pack -- <projectId> [--api http://127.0.0.1:3001]
// Turns a finished project into the committed demo bundle (database/seed/demo, spec row 17): fixed ids, files fetched
// from the API, the MP4 re-encoded at -crf 26, stills ≤ 1 MB. Refuses to write a bundle over 25 MB.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ProjectSchema } from "../../shared/contract";
import type { Asset, Project } from "../../shared/types";

const MAX_BYTES = 25 * 1024 ** 2, MAX_STILL = 1024 ** 2;
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const projectId = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!projectId) throw new Error("usage: npm run demo:pack -- <projectId> [--api http://127.0.0.1:3001]");
const apiUrl = flag("--api", "http://127.0.0.1:3001");
const out = resolve("database/seed/demo");
const tmp = join(out, ".pack");
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4" };

async function download(assetId: string, path: string): Promise<string> {
  const res = await fetch(`${apiUrl}/api/assets/${assetId}/file`);
  if (!res.ok) throw new Error(`asset ${assetId}: ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
}
const probe = (path: string) => {
  const [width, height, duration] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "default=nw=1:nk=1", path])
    .toString().trim().split("\n").map(Number);
  return { width, height, ...(duration && !path.endsWith(".jpg") ? { durationMs: Math.round(duration * 1000) } : {}) }; // stills have no duration
};
const asset = (id: string, kind: Asset["kind"], key: string, mimeType: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, projectId: "demo", kind, key, mimeType, sizeBytes: statSync(join(out, key)).size, createdAt: "2026-10-21T00:00:00.000Z", ...extra });

const p: Project = ProjectSchema.parse(await (await fetch(`${apiUrl}/api/projects/${projectId}`)).json());
const { mp4AssetId, srtAssetId, vttAssetId } = p.outputs;
if (!p.sourceAssetId || !mp4AssetId || !srtAssetId || !vttAssetId) throw new Error("render the project first (needs source, MP4, SRT, VTT)");
mkdirSync(tmp, { recursive: true });
const assets: Asset[] = [];

const srcMime = await download(p.sourceAssetId, join(out, "clip.mp4"));
assets.push(asset("demo-src", "video", "clip.mp4", srcMime, probe(join(out, "clip.mp4"))));

const overlays = [];
for (const [i, o] of p.overlays.entries()) {
  const raw = join(tmp, `ov-${i}`);
  const mime = await download(o.assetId, raw);
  let key = `broll-${i}.${EXT[mime] ?? "bin"}`;
  if (o.media === "image") { // stills: 1080 wide JPEG, quality stepped down until ≤ 1 MB
    key = `broll-${i}.jpg`;
    for (const q of [3, 5, 8, 12]) {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "scale='min(1080,iw)':-2", "-q:v", String(q), join(out, key)]);
      if (statSync(join(out, key)).size <= MAX_STILL) break;
    }
  } else execFileSync("cp", [raw, join(out, key)]);
  const id = `demo-ov-${i}`;
  assets.push(asset(id, o.media, key, o.media === "image" ? "image/jpeg" : mime, probe(join(out, key))));
  overlays.push({ ...o, assetId: id });
}

const mp4Raw = join(tmp, "render.mp4");
await download(mp4AssetId, mp4Raw);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp4Raw, "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", join(out, "demo.mp4")]);
assets.push(asset("demo-mp4", "render", "demo.mp4", "video/mp4", probe(join(out, "demo.mp4"))));
await download(srtAssetId, join(out, "demo.srt"));
assets.push(asset("demo-srt", "subtitle", "demo.srt", "text/plain"));
await download(vttAssetId, join(out, "demo.vtt"));
assets.push(asset("demo-vtt", "subtitle", "demo.vtt", "text/vtt"));
rmSync(tmp, { recursive: true, force: true });

const total = assets.reduce((n, a) => n + a.sizeBytes, 0);
if (total > MAX_BYTES) {
  for (const a of assets) rmSync(join(out, a.key), { force: true });
  throw new Error(`bundle is ${(total / 1024 ** 2).toFixed(1)} MB (> 25 MB); nothing written`);
}
const project: Project = {
  ...p, id: "demo", demo: true, status: "ready", sourceAssetId: "demo-src", overlays,
  brand: p.brand && { ...p.brand, logoAssetId: null }, // a logo would be one more file; the demo has none
  outputs: { mp4AssetId: "demo-mp4", srtAssetId: "demo-srt", vttAssetId: "demo-vtt", resolution: "1080p" },
  translations: [], burnInLanguage: null, warnings: [], createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z",
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify({ project, assets }, null, 2)}\n`);
console.log(`demo bundle: ${assets.length} files, ${(total / 1024 ** 2).toFixed(2)} MB → ${out}`);
