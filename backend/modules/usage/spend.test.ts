import { FakeGenerator } from "../../shared/generator";
import { makeTestDeps } from "../../shared/testing";
import type { LedgerEntry } from "./ledger";
import { OverCap, chargeGeneration, parseSpendCap } from "./spend";

const req = { projectId: "p1", prompt: "a sunrise over rice fields", media: "image" as const, width: 1080, height: 1920, jobKind: "generate" as const, actor: "agent" as const };
// makeTestDeps' clock is 2026-01-01T00:00:00Z, so rows dated in January 2026 count this month.
const row = (costCents: number, createdAt = "2026-01-01T00:00:00.000Z"): LedgerEntry =>
  ({ id: `r${costCents}${createdAt}`, projectId: "p0", provider: "fal", model: "fal-ai/flux/schnell", media: "image", costCents, jobKind: "broll", actor: "web", createdAt });

describe("parseSpendCap", () => {
  it("defaults when unset or empty, 0 turns it off, garbage refuses", () => {
    expect(parseSpendCap(undefined)).toBe(2000);
    expect(parseSpendCap("")).toBe(2000); // SPEND_CAP_CENTS= in a shell or compose file is not "no cap"
    expect(parseSpendCap(" ")).toBe(2000);
    expect(parseSpendCap("0")).toBe(0);
    expect(parseSpendCap("500")).toBe(500);
    for (const bad of ["20$", "-1", "1.5", "abc"]) expect(() => parseSpendCap(bad), bad).toThrow("SPEND_CAP_CENTS must be a whole number of cents (0 = no cap)");
  });
});

describe("chargeGeneration", () => {
  it("refuses before calling fal when the month would pass the cap", async () => {
    const deps = makeTestDeps({ spendCapCents: 25 });
    await deps.ledger.record(row(25));
    await deps.ledger.record(row(500, "2025-12-31T23:59:59.000Z")); // last month does not count
    const err = await chargeGeneration(deps, req).catch((e) => e);
    expect(err).toBeInstanceOf(OverCap);
    expect(err).toMatchObject({ message: "over_cap", monthCents: 25, capCents: 25 });
    expect((deps.generator as FakeGenerator).calls).toEqual([]);
  });

  it("charges up to the cap exactly", async () => {
    const deps = makeTestDeps({ spendCapCents: 26 });
    await deps.ledger.record(row(25));
    await expect(chargeGeneration(deps, req)).resolves.toMatchObject({ media: "image", costCents: 1 });
    await expect(chargeGeneration(deps, req)).rejects.toBeInstanceOf(OverCap);
  });

  it("cap 0 never refuses", async () => {
    const deps = makeTestDeps({ spendCapCents: 0 });
    await deps.ledger.record(row(100_000));
    await expect(chargeGeneration(deps, { ...req, media: "video" })).resolves.toMatchObject({ media: "video", costCents: 25 });
  });

  it("writes one row as soon as fal answers, without the prompt", async () => {
    const deps = makeTestDeps();
    const g = await chargeGeneration(deps, req);
    const rows = await deps.ledger.since(new Date(0));
    expect(rows).toEqual([{
      id: expect.any(String), projectId: "p1", provider: "fal", model: g.model, media: "image", costCents: 1, jobKind: "generate", actor: "agent", createdAt: "2026-01-01T00:00:00.000Z",
    }]);
    expect(JSON.stringify(rows)).not.toContain("rice fields");
  });
});
