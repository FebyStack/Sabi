import { Transform } from "node:stream";

export class TooLarge extends Error { constructor() { super("too_large"); } }

// Fails the pipeline once more than `max` bytes went through (uploads, remote media).
export const limitBytes = (max: number) => {
  let seen = 0;
  return new Transform({ transform(chunk: Buffer, _enc, cb) { seen += chunk.length; cb(seen > max ? new TooLarge() : null, chunk); } });
};
