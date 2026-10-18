import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// No @vitejs/plugin-react here on purpose (hangs on recent Node); JSX still works via esbuild.
export default defineConfig({
  resolve: {
    alias: { "@": r("./frontend/src"), "@ai": r("./ai"), "@shared": r("./shared") },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["frontend/src/**/*.test.{ts,tsx}", "backend/**/*.test.ts", "shared/**/*.test.ts", "ai/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist*/**", "**/._*"], // ExFAT SSD: macOS drops AppleDouble ._ files next to sources
    setupFiles: ["frontend/src/test/setup.ts"],
  },
});
