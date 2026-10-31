import { statfs } from "node:fs/promises";

// Spec row 30: an MP4 render needs room for Chrome's profile and Remotion's chunks (temp) and the MP4 (scratch);
// the Mac's system disk filling mid-render is what this guards. Stills, uploads and edits are not gated.
export const MIN_FREE_BYTES = 2 * 1024 ** 3;

export const freeBytesOf = (path: string) => statfs(path).then((s) => s.bavail * s.bsize);

export async function assertDiskRoom(freeBytes: (path: string) => Promise<number>, paths: string[]) {
  for (const path of paths) if ((await freeBytes(path)) < MIN_FREE_BYTES) throw new Error("disk_low");
}
