// The MG sandbox page's runtime (frontend/public/mg-sandbox.html, built by npm run build:mg-sandbox).
// It runs in an opaque-origin iframe whose CSP allows no network at all: everything arrives from the page as messages.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { FromSandbox, ToSandbox } from "../mgProtocol";
import { MgView, buildMotionGraphic, withBlobUrls, type MgConfig } from "../mgRuntime";

const host = window.parent; // captured once: code the MG runs can't reroute it
const post = (m: FromSandbox) => host.postMessage(m, "*"); // the page's origin is the only reader; its own is opaque to us
const report = (kind: "threw" | "image" | "blocked", detail: string) => post({ t: "problem", kind, detail });
addEventListener("securitypolicyviolation", (e) => report("blocked", `${e.effectiveDirective} ${e.blockedURI}`));

const root = createRoot(document.body.appendChild(document.createElement("div")));
const blobs = new Map<string, string>();
const pending = new Set<Promise<unknown>>();
let mg: { component: ReturnType<typeof buildMotionGraphic>; id: string; config: MgConfig } | null = null;

addEventListener("message", async (e: MessageEvent<ToSandbox>) => {
  if (e.source !== host) return;
  const m = e.data;
  if (m.t === "init" && !mg) {
    const style = document.createElement("style");
    style.textContent = m.fonts.css.replace(/__sabi_font_(\d+)__/g, (_, i: string) => URL.createObjectURL(m.fonts.files[Number(i)]));
    document.head.append(style);
    await Promise.all(m.images.map(([url, blob]) => {
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      blobs.set(url, img.src);
      return img.decode().catch(() => {});
    }));
    mg = { component: buildMotionGraphic(m.compiled, (msg) => report("threw", msg)), id: m.id, config: { id: "CaptionVideo", width: m.width, height: m.height, fps: m.fps, durationInFrames: 0 } };
    post({ t: "ready" });
  } else if (m.t === "draw" && mg) {
    const { component, id, config } = mg;
    flushSync(() => root.render(<MgView mg={component} id={id} frame={m.frame} item={withBlobUrls(m.item, blobs)} report={report}
      config={{ ...config, durationInFrames: m.item.durationInFrames }} track={(p) => pending.add(p)} />));
    void document.body.offsetHeight; // layout now, so the faces this frame needs start loading before fonts.ready is read
    const loads = [...pending];
    pending.clear();
    await Promise.allSettled(loads);
    await document.fonts.ready;
    post({ t: "drawn", seq: m.seq });
  }
});
