import { editorCsp, inlineScripts, sandboxPageHeaders, withCspMeta } from "./csp";

const directive = (policy: string, name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("editor CSP (spec row 27)", () => {
  it("the build policy", () => {
    expect(editorCsp({ dev: false, scriptHashes: [] })).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  it("dev adds the preamble's hash, websockets and the PostHog origin", () => {
    const p = editorCsp({ dev: true, scriptHashes: ["'sha256-abc='"], posthogHost: "https://eu.i.posthog.com/some/path" });
    expect(directive(p, "script-src")).toBe("script-src 'self' 'sha256-abc='");
    expect(directive(p, "connect-src")).toBe("connect-src 'self' ws: wss: https://eu.i.posthog.com");
  });

  it("never eval or inline script", () => {
    for (const p of [editorCsp({ dev: false, scriptHashes: [] }), editorCsp({ dev: true, scriptHashes: ["'sha256-x='"] })]) {
      expect(p).not.toContain("'unsafe-eval'");
      expect(directive(p, "script-src")).not.toContain("'unsafe-inline'");
    }
  });

  it("inlineScripts finds the bodies of scripts without src", () => {
    expect(inlineScripts('<script type="module">import a</script><script type="module" src="/x.js"></script>')).toEqual(["import a"]);
  });

  it("withCspMeta puts the policy first in head", () => {
    expect(withCspMeta("<html><head><title>S</title></head>", "default-src 'self'"))
      .toBe(`<html><head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'" />\n    <title>S</title></head>`);
  });

  // The sandbox page is served by the editor's origin: only Sabi may frame it, and the browser sandboxes it however
  // it is opened (security review, 2026-10-23); everything else gets frame-ancestors (no clickjacking of the editor).
  it("headers: the sandbox page is always sandboxed, everything else refuses foreign framing", () => {
    expect(sandboxPageHeaders("/mg-sandbox.html")).toEqual({ "Content-Security-Policy": "sandbox allow-scripts; frame-ancestors 'self'" });
    expect(sandboxPageHeaders("/mg-sandbox.html?x=1")).toEqual({ "Content-Security-Policy": "sandbox allow-scripts; frame-ancestors 'self'" });
    expect(sandboxPageHeaders("/p/abc")).toEqual({ "Content-Security-Policy": "frame-ancestors 'self'" });
  });
});
