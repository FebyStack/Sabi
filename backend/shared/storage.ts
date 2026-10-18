import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export interface Storage {
  write(key: string, data: Readable | Buffer): Promise<void>;
  read(key: string): Readable;
  stat(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
  localPath(key: string): string;
}

// Filesystem storage rooted at DATA_DIR (the SSD). An S3 adapter is plan 5.
export class FsStorage implements Storage {
  constructor(private root: string) {}

  localPath(key: string) {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error("bad_key");
    return p;
  }

  async write(key: string, data: Readable | Buffer) {
    const p = this.localPath(key);
    await mkdir(dirname(p), { recursive: true });
    if (Buffer.isBuffer(data)) await pipeline([data], createWriteStream(p));
    else await pipeline(data, createWriteStream(p));
  }

  read(key: string) { return createReadStream(this.localPath(key)); }

  async stat(key: string) {
    try { return { size: (await stat(this.localPath(key))).size }; } catch { return null; }
  }

  async remove(key: string) { await rm(this.localPath(key), { force: true }); }
}
