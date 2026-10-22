import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { editorCsp, inlineScripts, sandboxPageHeaders, withCspMeta } from "./frontend/src/csp";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const sha256 = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

// Editor CSP (spec row 27): a meta tag in index.html (dev and build, hashing whatever inline script ends up there),
// plus per-response frame-ancestors / the MG sandbox page's headers on the dev and preview servers (nginx does the same).
function csp(): Plugin {
  let posthogHost: string | undefined;
  const headers: Connect.NextHandleFunction = (req, res, next) => {
    for (const [k, v] of Object.entries(sandboxPageHeaders(req.url ?? "/"))) res.setHeader(k, v);
    next();
  };
  return {
    name: "sabi-csp",
    configResolved: (c) => { posthogHost = c.env.VITE_POSTHOG_HOST; },
    configureServer: (s) => { s.middlewares.use(headers); },
    configurePreviewServer: (s) => { s.middlewares.use(headers); },
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) => withCspMeta(html, editorCsp({ dev: !!ctx.server, scriptHashes: inlineScripts(html).map(sha256), posthogHost })),
    },
  };
}

export default defineConfig({
  root: "frontend",
  plugins: [react(), tailwindcss(), csp()],
  resolve: {
    alias: { "@": r("./frontend/src"), "@ai": r("./ai"), "@shared": r("./shared") },
  },
  worker: { format: "es" },
  build: { outDir: "../dist", emptyOutDir: true },
  // node_modules is a symlink to ~/Developer/.sabi-deps/<checkout> (PROJECT.md): allow it, or the bundled font files 403 in dev.
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3001" }, fs: { allow: [r("."), realpathSync(r("./node_modules"))] } },
});
