import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeGenerator } from "./generator";
import { FakeStock } from "./stock";
import { makeMemoryDeps } from "./testing";

describe("makeMemoryDeps", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("FAKE_AI=1 fakes the B-roll providers too, so the whole UI runs without keys", () => {
    vi.stubEnv("FAKE_AI", "1");
    vi.stubEnv("PEXELS_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    const deps = makeMemoryDeps(mkdtempSync(join(tmpdir(), "md-")));
    expect(deps.stock).toBeInstanceOf(FakeStock);
    expect(deps.generator).toBeInstanceOf(FakeGenerator);
  });

  it("without FAKE_AI a missing key leaves the provider unset", () => {
    vi.stubEnv("FAKE_AI", "");
    vi.stubEnv("PEXELS_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    const deps = makeMemoryDeps(mkdtempSync(join(tmpdir(), "md-")));
    expect(deps.stock).toBeNull();
    expect(deps.generator).toBeNull();
  });

  it("only real fal spend reaches the ledger file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "md-"));
    const row = { id: "r", projectId: "p", provider: "fal" as const, model: "m", media: "image" as const, costCents: 1, jobKind: "generate" as const, actor: "web" as const, createdAt: "2026-10-22T00:00:00.000Z" };
    vi.stubEnv("FAKE_AI", "1");
    await makeMemoryDeps(dir).ledger.record(row); // the fake generator costs nothing: memory only
    vi.stubEnv("FAKE_AI", "");
    expect(await makeMemoryDeps(dir).ledger.since(new Date(0))).toEqual([]);
    await makeMemoryDeps(dir).ledger.record(row);
    expect(await makeMemoryDeps(dir).ledger.since(new Date(0))).toEqual([row]); // real keys: the file, across restarts
  });
});

