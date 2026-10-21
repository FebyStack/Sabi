import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CUT_FADE_MS, cutFadeFilter, outputCutTimesMs, ownBundleDir, sharedBrowser } from "./renderer";

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

describe("audio fades at cuts", () => {
  it("cut positions are the joins between kept segments, in output time", () => {
    expect(outputCutTimesMs(undefined)).toEqual([]);
    expect(outputCutTimesMs([{ startMs: 0, endMs: 21000 }])).toEqual([]);
    expect(outputCutTimesMs([{ startMs: 0, endMs: 1000 }, { startMs: 3000, endMs: 5000 }, { startMs: 5500, endMs: 9000 }])).toEqual([1000, 3000]);
  });

  it("the gain is 0 at each cut and back to 1 within 15 ms on both sides", () => {
    expect(CUT_FADE_MS).toBe(15);
    expect(cutFadeFilter([1000, 3000])).toBe("aeval='val(ch)*min(1,if(lt(t,2.000),abs(t-1.000),abs(t-3.000))/0.015)':c=same");
    // A binary search over the cuts: split halfway between neighbours.
    expect(cutFadeFilter([1000, 2000, 4000])).toBe(
      "aeval='val(ch)*min(1,if(lt(t,3.000),if(lt(t,1.500),abs(t-1.000),abs(t-2.000)),abs(t-4.000))/0.015)':c=same");
    expect(cutFadeFilter([2500])).toBe("aeval='val(ch)*min(1,abs(t-2.500)/0.015)':c=same");
  });
});
