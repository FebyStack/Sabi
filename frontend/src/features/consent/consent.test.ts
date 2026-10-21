import { anonymousId, readConsent, writeConsent } from "./consent";

const memoryStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("consent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads and writes", () => {
    const s = memoryStorage();
    vi.stubGlobal("localStorage", s);
    expect(readConsent()).toBeNull();
    writeConsent({ analytics: true, at: "2026-10-21T00:00:00.000Z" });
    expect(s.m.get("sabi.consent")).toBe('{"analytics":true,"at":"2026-10-21T00:00:00.000Z"}');
    expect(readConsent()).toEqual({ analytics: true, at: "2026-10-21T00:00:00.000Z" });
    const id = anonymousId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(anonymousId()).toBe(id); // created once
    expect(s.m.get("sabi.aid")).toBe(id);
    s.m.set("sabi.consent", "not json");
    expect(readConsent()).toBeNull();
  });

  it("consent survives a throwing localStorage", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } });
    expect(readConsent()).toBeNull();
    expect(() => writeConsent({ analytics: false, at: "x" })).not.toThrow();
    expect(anonymousId()).toMatch(/^[0-9a-f-]{36}$/);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } }); // private mode: even the getter throws
    expect(readConsent()).toBeNull();
    expect(() => writeConsent({ analytics: true, at: "x" })).not.toThrow();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
