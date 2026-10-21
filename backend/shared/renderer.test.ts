import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownBundleDir, sharedBrowser } from "./renderer";

type B = { id: number; close: () => Promise<void> };
const opener = () => {
  let n = 0;
  const closed: number[] = [];
  const open = vi.fn(async (): Promise<B> => { const id = ++n; return { id, close: async () => { closed.push(id); } }; });
  return { open, closed };
};

describe("sharedBrowser", () => {
  it("opens one browser lazily and reuses it", async () => {
    const { open } = opener();
    const b = sharedBrowser(open);
    expect(open).not.toHaveBeenCalled();
    const [x, y] = await Promise.all([b.get(), b.get()]); // concurrent first renders share one launch
    expect(x).toBe(y);
    expect((await b.get()).id).toBe(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("after a failed render it closes the browser and the next render opens a fresh one", async () => {
    const { open, closed } = opener();
    const b = sharedBrowser(open);
    await b.get();
    await b.reset();
    expect(closed).toEqual([1]);
    expect((await b.get()).id).toBe(2);
  });

  it("a failed launch is not cached", async () => {
    const open = vi.fn<() => Promise<B>>().mockRejectedValueOnce(new Error("no chrome")).mockResolvedValueOnce({ id: 7, close: async () => {} });
    const b = sharedBrowser(open);
    await expect(b.get()).rejects.toThrow("no chrome");
    expect((await b.get()).id).toBe(7);
  });
});

describe("ownBundleDir", () => {
  const base = () => mkdtempSync(join(tmpdir(), "bundle-dir-"));

  it("creates the bundle folder private to this user", async () => {
    const dir = join(base(), "b");
    await ownBundleDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    await ownBundleDir(dir); // an existing private folder is fine
  });

  it("refuses a planted symlink or a folder others can write", async () => {
    const b = base();
    mkdirSync(join(b, "real"));
    symlinkSync(join(b, "real"), join(b, "link"));
    await expect(ownBundleDir(join(b, "link"))).rejects.toThrow("unsafe_bundle_dir");
    mkdirSync(join(b, "open"));
    chmodSync(join(b, "open"), 0o777);
    await expect(ownBundleDir(join(b, "open"))).rejects.toThrow("unsafe_bundle_dir");
  });
});
