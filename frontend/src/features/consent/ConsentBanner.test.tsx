import { renderToStaticMarkup } from "react-dom/server";
import { ConsentBanner } from "./ConsentBanner";

describe("ConsentBanner", () => {
  beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} }));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("names the 30-day retention and both choices", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "k");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://h");
    const html = renderToStaticMarkup(<ConsentBanner />);
    expect(html).toContain('role="dialog" aria-label="Privacy"');
    expect(html).toContain("Sabi keeps your uploads, generated media and renders for 30 days after you last open a project, then deletes them.");
    expect(html).toContain("Allow anonymous usage analytics (which features you use, never your media)?");
    expect(html).toContain(">Decline<");
    expect(html).toContain(">Allow<");
  });

  it("without analytics keys it only offers OK", () => {
    const html = renderToStaticMarkup(<ConsentBanner />);
    expect(html).toContain("Analytics is off in this build.");
    expect(html).toContain(">OK<");
    expect(html).not.toContain(">Allow<");
  });

  it("is hidden once the viewer answered", () => {
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "sabi.consent" ? '{"analytics":false,"at":"x"}' : null), setItem: () => {} });
    expect(renderToStaticMarkup(<ConsentBanner />)).toBe("");
  });
});
