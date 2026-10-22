import { z } from "zod";
import { MgProblemSchema } from "../contract";
import { logMgProblem, mgLogLine, mgProblemsHeader, parseFromSandbox, parseMgLog } from "./mgProtocol";

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
