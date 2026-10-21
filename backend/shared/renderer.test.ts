import { sharedBrowser } from "./renderer";

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
