import { useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, getRemotionEnvironment, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandLook } from "../editing/brand";
import type { MotionGraphicProps } from "../editing/overlays";
import { fontCssFamily } from "./fonts";
import { fontPayload, imageBlobs } from "./mgAssets";
import { MgPlaceholder } from "./mgPlaceholder";
import { MgChannel, logMgProblem, parseFromSandbox, type MgItem, type ToSandbox } from "./mgProtocol";
import { msToFrames } from "./OverlayLayer";

type Box = { left: number; top: number; width: number; height: number };

export function mgWindow(mg: MotionGraphicProps, fps: number, frame: number) {
  const from = msToFrames(mg.startMs, fps);
  const durationInFrames = msToFrames(mg.endMs, fps) - from;
  const local = frame - from;
  return { from, durationInFrames, local, active: durationInFrames > 0 && local >= 0 && local < durationInFrames };
}

// New code or a new image gets a fresh sandbox (a fixed MG drops its ⚠); props and colours just redraw.
export const sandboxKey = (mg: MotionGraphicProps, brand: BrandLook) => [mg.compiled, ...mg.images, brand.logoUrl ?? ""].join("\n");

// Agent-written code runs only inside its own sandboxed iframe (spec row 24), the same in the Player, /frame and the MP4.
// The iframe lives for the whole composition so it never boots mid-playback; outside its range it is hidden.
export function MotionGraphicLayer({ mg, brand, width, height }: { mg: MotionGraphicProps; brand: BrandLook; width: number; height: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const w = mgWindow(mg, fps, frame);
  if (w.durationInFrames <= 0) return null;
  const box = { left: mg.box.x * width, top: mg.box.y * height, width: mg.box.w * width, height: mg.box.h * height };
  // fontFamily is the bundled CSS family, so `${b.fontFamily}, system-ui` in MG code finds the face the page hands over
  const item: MgItem = { props: mg.props, brand: { ...brand, fontFamily: fontCssFamily(brand.fontFamily) }, width: box.width, height: box.height, durationInFrames: w.durationInFrames };
  return <MgSandbox key={sandboxKey(mg, brand)} mg={mg} item={item} box={box} fps={fps} width={width} height={height} active={w.active} local={w.local} />;
}

function MgSandbox({ mg, item, box, fps, width, height, active, local }:
  { mg: MotionGraphicProps; item: MgItem; box: Box; fps: number; width: number; height: number; active: boolean; local: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const link = useRef<{ ch: MgChannel; port: MessagePort } | null>(null);
  const loads = useRef(0);
  const shown = useRef(false);
  const [dead, setDead] = useState(false);
  const rendering = getRemotionEnvironment().isRendering;

  // One channel per sandbox (the key remounts it). StrictMode runs this twice in dev, hence the setup here, not in render.
  // The sandbox gets its end of a MessageChannel with init: nothing else reaches it, even if its frame navigated.
  useLayoutEffect(() => {
    const { port1, port2 } = new MessageChannel();
    const start = rendering ? delayRender(`mg ${mg.id} start`) : null;
    const ch = new MgChannel((m) => port1.postMessage(m), (detail) => {
      logMgProblem({ mg: mg.id, kind: "silent", detail });
      setDead(true);
    });
    link.current = { ch, port: port2 };
    void ch.ready.then(() => { if (start !== null) continueRender(start); });
    port1.onmessage = (e) => {
      const m = parseFromSandbox(e.data);
      if (m?.t === "problem") logMgProblem({ mg: mg.id, kind: m.kind, detail: m.detail });
      else if (m) ch.receive(m);
    };
    return () => { port1.close(); ch.kill(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const itemKey = JSON.stringify(item);
  useLayoutEffect(() => {
    const ch = link.current?.ch;
    if (!ch || dead) return;
    if (!active) {
      if (shown.current) void ch.draw(null, item); // blank it, so re-entering never flashes a stale frame
      shown.current = false;
      return;
    }
    shown.current = true;
    const h = rendering ? delayRender(`mg ${mg.id} frame ${local}`) : null;
    void ch.draw(local, item).then(() => { if (h !== null) continueRender(h); });
  }, [active, local, itemKey, dead]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLoad = () => {
    const l = link.current;
    if (!l) return;
    if (++loads.current > 1) { // the sandbox navigated: the page's frame-src blocked it, but its own content is gone
      logMgProblem({ mg: mg.id, kind: "navigated", detail: "tried to leave its frame" });
      l.ch.kill();
      setDead(true);
      return;
    }
    const urls = item.brand.logoUrl ? [...mg.images, item.brand.logoUrl] : mg.images;
    void Promise.all([fontPayload(), imageBlobs(urls)]).then(([fonts, { blobs, failed }]) => {
      for (const url of failed) logMgProblem({ mg: mg.id, kind: "image", detail: url });
      const init: ToSandbox = { t: "init", id: mg.id, compiled: mg.compiled, fps, width, height, fonts, images: blobs };
      ref.current?.contentWindow?.postMessage(init, "*", [l.port]); // "*": an opaque origin can't be named
    });
  };

  if (dead) return active ? <div style={{ position: "absolute", ...box }}><MgPlaceholder id={mg.id} /></div> : null;
  return (
    <iframe ref={ref} src={staticFile("mg-sandbox.html")} sandbox="allow-scripts" title={mg.id} aria-hidden tabIndex={-1} onLoad={onLoad}
      style={{ position: "absolute", ...box, border: 0, pointerEvents: "none", colorScheme: "normal", visibility: active ? "visible" : "hidden" }} />
  );
}
