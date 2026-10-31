import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One temp folder for a test run: os.tmpdir() reads TMPDIR on every call, so every mkdtempSync(join(tmpdir(), …)) a suite makes
// (stores, ledgers, Chrome profiles) lands inside it and goes with it. The suites had left thousands of dirs on the Mac disk.
export function isolateTmpdir(): () => void {
  const prev = process.env.TMPDIR;
  const dir = mkdtempSync(join(tmpdir(), "sabi-test-"));
  process.env.TMPDIR = dir;
  return () => {
    if (prev === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prev;
    rmSync(dir, { recursive: true, force: true });
  };
}
