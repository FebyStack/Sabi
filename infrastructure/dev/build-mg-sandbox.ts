// Builds frontend/public/mg-sandbox.html: the page every motion graphic runs in (spec row 24), served by Vite and
// by the renderer's Remotion bundle (publicDir). Committed; backend/modules/mg/sandbox.test.ts fails when it is stale.
// Usage: npm run build:mg-sandbox (after changing shared/remotion/sandbox/, mgRuntime.ts or the React/Remotion versions).
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; base-uri 'none'; form-action 'none'";
const root = fileURLToPath(new URL("../../", import.meta.url));
// First statement of the page: at Sabi's own origin (another site framing it without `sandbox`, or a plain visit) the MG
// code it is sent would run as the editor, so nothing runs unless the browser gave the page an opaque origin.
const GUARD = 'if(self.origin!=="null")throw Error("mg-sandbox: open it only in a sandboxed frame");';

export async function buildMgSandboxHtml(): Promise<string> {
  const out = await build({
    entryPoints: [`${root}shared/remotion/sandbox/entry.tsx`], absWorkingDir: root, bundle: true, format: "iife", minify: true,
    legalComments: "none", define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic", write: false, logLevel: "error", banner: { js: GUARD },
  });
  const js = out.outputFiles[0].text.replaceAll("</script", "<\\/script");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><style>html,body{margin:0;background:transparent}</style></head><body><script>${js}</script></body></html>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(`${root}frontend/public/mg-sandbox.html`, await buildMgSandboxHtml());
