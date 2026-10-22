// Remotion entry: bundled by @remotion/bundler on the server; the browser Player imports CaptionVideo directly.
import { registerRoot } from "remotion";
import { Root } from "./Root";

// Motion graphics run in sandboxed frames (spec row 24): frames here may load only this page's origin, so a sandbox
// can't navigate itself to another host.
const frameLock = document.createElement("meta");
frameLock.httpEquiv = "Content-Security-Policy";
frameLock.content = "frame-src 'self'";
document.head.prepend(frameLock);

registerRoot(Root);
