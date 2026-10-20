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
});
