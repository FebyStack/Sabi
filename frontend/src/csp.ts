// The editor's Content-Security-Policy (spec row 27), put into index.html by vite.config.ts in dev and build.
// No 'unsafe-eval' and no inline script: agent-written motion graphics never run in this page (spec row 24).
export function editorCsp({ dev, scriptHashes, posthogHost }: { dev: boolean; scriptHashes: string[]; posthogHost?: string }): string {
  const connect = ["'self'", ...(dev ? ["ws:", "wss:"] : []), ...(posthogHost ? [new URL(posthogHost).origin] : [])];
  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes].join(" "), // dev: the React refresh preamble, by hash
    "style-src 'self' 'unsafe-inline'", // Vite's dev CSS and the Player's style tags
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:", // data: the Player's silent clip that unlocks audio
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "frame-src 'self'", // MG sandboxes load only /mg-sandbox.html here, and can't navigate to another host
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export const inlineScripts = (html: string): string[] =>
  [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

export const withCspMeta = (html: string, policy: string) =>
  html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    `);

// Response headers (dev server and nginx): the sandbox page is sandboxed however it is opened and only Sabi may frame
// it; nothing else may be framed by another site.
export const sandboxPageHeaders = (url: string): Record<string, string> => ({
  "Content-Security-Policy": url.split("?")[0] === "/mg-sandbox.html" ? "sandbox allow-scripts; frame-ancestors 'self'" : "frame-ancestors 'self'",
});
