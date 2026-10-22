import { z } from "zod";
import { getCaptionTemplate } from "../captions/templates";
import { MgProblemSchema } from "../contract";
import { templateLook } from "../editing/brand";
import { MgChannel, logMgProblem, mgLogLine, mgProblemsHeader, parseFromSandbox, parseMgLog, type MgItem, type ToSandbox } from "./mgProtocol";

const item: MgItem = { props: {}, brand: templateLook(getCaptionTemplate("clean")), width: 100, height: 100, durationInFrames: 30 };
const settled = (p: Promise<void>) => {
  const s = { done: false };
  void p.then(() => { s.done = true; });
  return s;
};

describe("MgChannel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const open = () => {
    const posted: ToSandbox[] = [];
    const silent = vi.fn();
    return { posted, silent, ch: new MgChannel((m) => posted.push(m), silent) };
  };

  it("draws only after ready and settles on its own answer", async () => {
    const { posted, ch } = open();
    const d = settled(ch.draw(7, item));
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toEqual([]);
    ch.receive({ t: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toEqual([{ t: "draw", seq: 1, frame: 7, item }]);
    ch.receive({ t: "drawn", seq: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.done).toBe(false);
    ch.receive({ t: "drawn", seq: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.done).toBe(true);
  });

  it("a sandbox that never starts dies after 15 s", async () => {
    const { posted, silent, ch } = open();
    const d = settled(ch.draw(0, item));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(ch.dead).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(silent).toHaveBeenCalledWith("did not start in 15 s");
    expect(ch.dead).toBe(true);
    expect(d.done).toBe(true);
    expect(posted).toEqual([]);
  });

  it("an unanswered frame kills the channel after 5 s", async () => {
    const { posted, silent, ch } = open();
    ch.receive({ t: "ready" });
    void ch.draw(0, item);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(silent).toHaveBeenCalledWith("no answer for 5 s");
    expect(ch.dead).toBe(true);
    const d = settled(ch.draw(1, item));
    await vi.advanceTimersByTimeAsync(0);
    expect(d.done).toBe(true);
    expect(posted).toHaveLength(1);
  });

  it("kill settles pending draws without onSilent", async () => {
    const { silent, ch } = open();
    ch.receive({ t: "ready" });
    const d = settled(ch.draw(0, item));
    ch.kill();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(d.done).toBe(true);
    expect(silent).not.toHaveBeenCalled();
  });
});

describe("mgProtocol", () => {
  it("accepts only the three sandbox messages and cuts details to 200 chars", () => {
    expect(parseFromSandbox({ t: "ready" })).toEqual({ t: "ready" });
    expect(parseFromSandbox({ t: "drawn", seq: 3 })).toEqual({ t: "drawn", seq: 3 });
    expect(parseFromSandbox({ t: "problem", kind: "blocked", detail: "x".repeat(1_000_000) }))
      .toEqual({ t: "problem", kind: "blocked", detail: "x".repeat(200) });
    for (const bad of [null, "ready", { t: "drawn", seq: "3" }, { t: "drawn", seq: 1.5 }, { t: "init" },
      { t: "problem", kind: "navigated", detail: "" }, { t: "problem", kind: "threw" }]) expect(parseFromSandbox(bad)).toBeNull();
  });

  it("problem log lines round-trip; anything else is not a problem", () => {
    const p = { mg: "mg-0", kind: "threw", detail: "TypeError: x is undefined" } as const;
    expect(mgLogLine(p)).toBe('sabi:mg {"mg":"mg-0","kind":"threw","detail":"TypeError: x is undefined"}');
    expect(parseMgLog(mgLogLine(p))).toEqual(p);
    for (const t of ["hello", "sabi:mg {", 'sabi:mg {"mg":"mg-0","kind":"exploded","detail":""}']) expect(parseMgLog(t)).toBeNull();
  });

  it("logs each problem once per page", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = { mg: "mg-9", kind: "silent", detail: "no answer for 5 s" } as const;
    logMgProblem(p);
    logMgProblem(p);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(mgLogLine(p));
    warn.mockRestore();
  });

  it("the problems header is printable ASCII, ≤ 10 entries of ≤ 200 chars, and parses back", () => {
    const ps = Array.from({ length: 12 }, (_, i) => ({ mg: `mg-${i}`, kind: "threw" as const, detail: `Hindi ma-load ang larawan 🖼️ ${"é".repeat(300)}` }));
    const h = mgProblemsHeader(ps);
    expect(/^[\x20-\x7e]*$/.test(h)).toBe(true);
    const back = z.array(MgProblemSchema).parse(JSON.parse(h));
    expect(back).toHaveLength(10);
    expect(back[0].detail.startsWith("Hindi ma-load ang larawan 🖼️")).toBe(true);
  });
});
