import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { access, copyFile, lstat, mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export type ByteRange = { start: number; end: number }; // inclusive, as in HTTP Range

// An object store plus a local scratch area: ffmpeg and Remotion need real files, the store may be a bucket.
export interface Storage {
  write(key: string, data: Readable | Buffer): Promise<void>;
  read(key: string, range?: ByteRange): Promise<Readable>; // rejects when the key is missing
  stat(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
  put(key: string, localPath: string): Promise<void>; // moves a finished local file in (the local file is gone after)
  withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T>; // a readable local copy for the duration of fn
  workPath(name: string): string; // local scratch file path; its folder exists
  sweepWork(): Promise<void>; // boot: drop what a crash left in scratch (see sweepScratch)
  describe(): string; // "fs:<root>" | "s3:<bucket>": which store a database's keys live in
}

// Keys are relative paths with plain segments, so no key can name anything outside the store.
export function checkKey(key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((s) => s === "" || s === "." || s === "..")) throw new Error("bad_key");
  return key;
}

const SCRATCH_TTL_MS = 3_600_000;

// A crash leaves scratch behind (uploads in flight, partial renders, stills, S3 downloads). At boot, remove the files nothing has
// touched for an hour and the folders that were stale and end up empty; the root stays. Fresh files stay: another API on the
// same folder (a second worktree, a dev server that then finds its port taken) may be mid-job, and no job leaves a file that long.
// Links are removed, never followed.
export async function sweepScratch(root: string, now = Date.now()): Promise<void> {
  const stale = (p: string) => lstat(p).then((s) => now - s.mtimeMs > SCRATCH_TTL_MS, () => false);
  for (const e of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const p = join(root, e.name);
    if (!e.isDirectory()) {
      if (await stale(p)) await rm(p, { force: true });
      continue;
    }
    const old = await stale(p); // before sweeping inside changes its mtime
    await sweepScratch(p, now);
    if (old) await rmdir(p).catch(() => {}); // only if empty
  }
}

// Files under DATA_DIR (the SSD); scratch under DATA_DIR/work, so put() is a rename on the same disk.
export class FsStorage implements Storage {
  constructor(private root: string) {}

  private path(key: string) { return join(this.root, checkKey(key)); }

  async write(key: string, data: Readable | Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(Buffer.isBuffer(data) ? [data] : data, createWriteStream(p));
  }

  async read(key: string, range?: ByteRange) {
    const p = this.path(key);
    await access(p);
    return createReadStream(p, range);
  }

  async stat(key: string) {
    const p = this.path(key);
    try { return { size: (await stat(p)).size }; } catch { return null; }
  }

  async remove(key: string) { await rm(this.path(key), { force: true }); }

  async put(key: string, localPath: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await rename(localPath, p).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EXDEV") throw err;
      await copyFile(localPath, p);
      await rm(localPath, { force: true });
    });
  }

  async withLocalFile<T>(key: string, fn: (path: string) => Promise<T>) {
    const p = this.path(key);
    await access(p);
    return fn(p);
  }

  workPath(name: string) {
    const p = join(this.root, "work", checkKey(name));
    mkdirSync(dirname(p), { recursive: true });
    return p;
  }

  sweepWork() { return sweepScratch(join(this.root, "work")); }

  describe() { return `fs:${this.root}`; }
}
