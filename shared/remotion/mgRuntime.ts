import React, { Component as ReactComponent, createContext, createElement, useContext, useLayoutEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AbsoluteFill, Easing, interpolate, interpolateColors, random, spring } from "remotion";
import { MgPlaceholder } from "./mgPlaceholder";
import type { MgItem } from "./mgProtocol";

// Runs only inside an MG's sandbox page (spec row 24), never in a Sabi page.
type Mg = ComponentType<{ item: MgItem }>;
type Report = (kind: "threw" | "image", detail: string) => void;
export type MgConfig = { id: "CaptionVideo"; width: number; height: number; fps: number; durationInFrames: number };
type Ctx = { frame: number; config: MgConfig; report: Report; track: (load: Promise<unknown>) => void };

const MgCtx = createContext<Ctx | null>(null);
const useMg = () => {
  const c = useContext(MgCtx);
  if (!c) throw new Error("not inside a motion graphic");
  return c;
};
// The MG's own frame and the frame size; durationInFrames is the MG's length (as inside Remotion's <Sequence>).
const useCurrentFrame = () => useMg().frame;
const useVideoConfig = () => useMg().config;

// A broken image draws a marker instead of nothing; each load is tracked so the frame is answered only once it is drawn.
function Img(props: ComponentProps<"img">) {
  const { report, track } = useMg();
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fail = () => { flushSync(() => setBroken(true)); report("image", String(props.src)); };
    if (el.complete) { if (!el.naturalWidth) fail(); return; }
    track(new Promise<void>((done) => {
      el.addEventListener("load", () => void el.decode().catch(() => {}).then(done), { once: true });
      el.addEventListener("error", () => { fail(); done(); }, { once: true });
    }));
  }, [props.src]); // eslint-disable-line react-hooks/exhaustive-deps
  if (broken) return createElement("div", { style: { ...props.style, background: "rgba(255,0,0,.85)", color: "white", fontSize: 18, fontFamily: "system-ui, sans-serif" } }, "⚠ image");
  return createElement("img", { ...props, ref });
}

// The only names the compiled code can see (the server already rejected imports and denied globals).
export const MG_SCOPE = { React, AbsoluteFill, Img, Easing, interpolate, interpolateColors, random, spring, useCurrentFrame, useVideoConfig };

// Stands in for code that throws while being evaluated or defines no component.
export const MgBroken: Mg = () => null;

export function buildMotionGraphic(compiled: string, onError?: (message: string) => void): Mg {
  try {
    const made: unknown = new Function(...Object.keys(MG_SCOPE), `"use strict";\n${compiled}\nreturn Component;`)(...Object.values(MG_SCOPE));
    if (typeof made === "function") return made as Mg;
    onError?.("no Component");
  } catch (e) {
    onError?.(e instanceof Error ? e.message : String(e));
  }
  return MgBroken;
}

// Image props and the logo arrive as the page's URLs; the sandbox holds them as blobs (it has no network).
export const withBlobUrls = (item: MgItem, blobs: Map<string, string>): MgItem => ({
  ...item,
  props: Object.fromEntries(Object.entries(item.props).map(([k, v]) => [k, typeof v === "string" ? blobs.get(v) ?? v : v])),
  brand: { ...item.brand, logoUrl: item.brand.logoUrl && (blobs.get(item.brand.logoUrl) ?? item.brand.logoUrl) },
});

// An MG that throws while rendering draws its placeholder and says why.
class MgBoundary extends ReactComponent<{ id: string; report: Report; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { this.props.report("threw", e instanceof Error ? e.message : String(e)); }
  render() { return this.state.failed ? createElement(MgPlaceholder, { id: this.props.id }) : this.props.children; }
}

const ROOT = { position: "absolute", inset: 0, overflow: "hidden" } as const;

// One frame of one MG, filling its box. frame null (outside its range) draws nothing.
export function MgView({ mg, id, frame, item, config, report, track }:
  { mg: Mg; id: string; frame: number | null; item: MgItem; config: MgConfig; report: Report; track: (load: Promise<unknown>) => void }): ReactElement | null {
  if (frame === null) return null;
  return createElement("div", { style: ROOT },
    createElement(MgCtx.Provider, { value: { frame, config, report, track } },
      mg === MgBroken ? createElement(MgPlaceholder, { id }) : createElement(MgBoundary, { id, report }, createElement(mg, { item }))));
}
