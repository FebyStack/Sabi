import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateTmpdir } from "./testDirs";

it("points os.tmpdir() at a fresh folder and removes it, with everything made in it, on restore", () => {
  const before = tmpdir();
  const restore = isolateTmpdir();
  const inside = mkdtempSync(join(tmpdir(), "cc-"));
  writeFileSync(join(inside, "f"), "x");
  expect(inside.startsWith(join(before, "sabi-test-"))).toBe(true);
  restore();
  expect(tmpdir()).toBe(before);
  expect(existsSync(inside)).toBe(false);
});
