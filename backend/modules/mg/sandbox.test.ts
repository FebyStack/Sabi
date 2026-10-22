import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { SANDBOX_CSP, buildMgSandboxHtml } from "../../../infrastructure/dev/build-mg-sandbox";

const committed = () => readFileSync("frontend/public/mg-sandbox.html", "utf8");

describe("MG sandbox page", () => {
  it("the committed sandbox page is the current build", async () => {
    expect(committed() === await buildMgSandboxHtml(), "stale: run npm run build:mg-sandbox").toBe(true);
  }, 60_000);

  it("the page denies all network before its only script", () => {
    const html = committed();
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html.indexOf(`content="${SANDBOX_CSP}"`)).toBeGreaterThan(0);
    expect(html.indexOf(`content="${SANDBOX_CSP}"`)).toBeLessThan(html.indexOf("<script>"));
    // One script element: the build escapes every "</script" inside the JS, and without "<!--" an opening "<script"
    // in a JS string (React has one) can't change how the HTML parser reads the script.
    expect(html.match(/<\/script/g)).toHaveLength(1);
    expect(html).toContain("<body><script>");
    expect(html).not.toContain("<!--");
  });

  // Opened at Sabi's own origin (another site framing it without `sandbox`, or a plain visit), MG code it was sent
  // would run as the editor; the script stops before any code, React or Remotion runs.
  it("the page refuses to run unless the browser sandboxed it (opaque origin)", () => {
    const js = /<script>([\s\S]*)<\/script>/.exec(committed())![1];
    expect(() => runInNewContext(js, { self: { origin: "http://localhost:5173" } })).toThrow("mg-sandbox: open it only in a sandboxed frame");
  });
});
