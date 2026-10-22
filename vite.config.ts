import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "frontend",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": r("./frontend/src"), "@ai": r("./ai"), "@shared": r("./shared") },
  },
  worker: { format: "es" },
  build: { outDir: "../dist", emptyOutDir: true },
  // node_modules is a symlink to ~/Developer/.sabi-deps/<checkout> (PROJECT.md): allow it, or the bundled font files 403 in dev.
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" }, fs: { allow: [r("."), realpathSync(r("./node_modules"))] } },
});
