import { configured, track } from "./analytics";
import { writeConsent } from "./consent";

const memoryStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("analytics", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("track is a no-op without consent or keys", () => {
    const fetch = vi.fn(async () => new Response());
    vi.stubGlobal("fetch", fetch);
    expect(configured()).toBe(false);
    writeConsent({ analytics: true, at: "x" });
    track("project_created"); // consent, no keys
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");
    writeConsent({ analytics: false, at: "x" });
    track("project_created"); // keys, declined
    localStorage.setItem("sabi.consent", "");
    track("upload_done"); // keys, no answer yet
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a capture with the anonymous id when allowed and configured", () => {
    const fetch = vi.fn(async () => new Response());
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");
    writeConsent({ analytics: true, at: "x" });
    track("export_downloaded", { kind: "mp4" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eu.i.posthog.com/capture/");
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ api_key: "phc_test", event: "export_downloaded", distinct_id: localStorage.getItem("sabi.aid"), properties: { kind: "mp4", $lib: "sabi" } });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it("a failing request never throws", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    vi.stubEnv("VITE_POSTHOG_KEY", "k");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://h");
    writeConsent({ analytics: true, at: "x" });
    expect(() => track("render_done")).not.toThrow();
  });
});
