import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlCreditLedger, MemoryCreditLedger, monthStart, usageMonths, type CreditLedger, type LedgerEntry } from "./ledger";

const entry = (id: string, createdAt: string, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ id, projectId: "p1", provider: "fal", model: "fal-ai/flux/schnell", media: "image", costCents: 1, jobKind: "generate", actor: "web", createdAt, ...extra });
const jsonlPath = () => join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.jsonl");

describe.each([
  ["memory", (): CreditLedger => new MemoryCreditLedger()],
  ["jsonl", (): CreditLedger => new JsonlCreditLedger(jsonlPath())],
])("%s ledger", (_name, make) => {
  it("records and returns rows newest first since a date", async () => {
    const ledger = make();
    await ledger.record(entry("sep", "2026-09-30T23:59:59.999Z"));
    await ledger.record(entry("oct2", "2026-10-02T00:00:00.000Z"));
    await ledger.record(entry("oct1", "2026-10-01T00:00:00.000Z"));
    expect((await ledger.since(new Date("2026-10-01T00:00:00.000Z"))).map((e) => e.id)).toEqual(["oct2", "oct1"]);
  });
});

describe("JsonlCreditLedger", () => {
  it("survives a new instance on the same file", async () => {
    const path = jsonlPath();
    await new JsonlCreditLedger(path).record(entry("a", "2026-10-05T00:00:00.000Z", { actor: "agent", costCents: 25, media: "video" }));
    expect(await new JsonlCreditLedger(path).since(new Date(0))).toEqual([entry("a", "2026-10-05T00:00:00.000Z", { actor: "agent", costCents: 25, media: "video" })]);
  });

  it("skips a malformed line", async () => {
    const path = jsonlPath();
    const ledger = new JsonlCreditLedger(path);
    await ledger.record(entry("a", "2026-10-05T00:00:00.000Z"));
    appendFileSync(path, '{"id":"half-written\n');
    await ledger.record(entry("b", "2026-10-06T00:00:00.000Z"));
    expect((await ledger.since(new Date(0))).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("an absent file is an empty ledger", async () => {
    expect(await new JsonlCreditLedger(jsonlPath()).since(new Date(0))).toEqual([]);
  });
});

describe("monthStart", () => {
  it("is the start of the UTC month", () => {
    expect(monthStart(new Date("2026-10-31T16:30:00.000Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-11-01T00:30:00+08:00")).toISOString()).toBe("2026-10-01T00:00:00.000Z"); // still October in UTC
    expect(monthStart(new Date("2026-01-15T00:00:00.000Z")).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("usageMonths", () => {
  it("groups by month, keeps totals over capped rows, names deleted projects null", () => {
    const oct = Array.from({ length: 105 }, (_, i) => entry(`o${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00.000Z`));
    const sep = entry("s", "2026-09-10T00:00:00.000Z", { projectId: "gone", costCents: 25, media: "video", model: "fal-ai/kling-video/v1.6/standard/image-to-video", actor: "agent" });
    const old = entry("old", "2025-09-30T00:00:00.000Z"); // 13 months back: outside the window
    const months = usageMonths([...oct, sep, old], new Map([["p1", "Morning"]]), new Date("2026-10-31T00:00:00.000Z"));
    expect(months.map((m) => [m.month, m.totalCents, m.rows.length])).toEqual([["2026-10", 105, 100], ["2026-09", 25, 1]]);
    expect(months[0].rows[0]).toMatchObject({ projectId: "p1", projectTitle: "Morning" });
    expect(months[1].rows[0]).toEqual({
      id: "s", createdAt: "2026-09-10T00:00:00.000Z", model: "fal-ai/kling-video/v1.6/standard/image-to-video", media: "video", costCents: 25,
      jobKind: "generate", actor: "agent", projectId: "gone", projectTitle: null,
    });
  });
});
