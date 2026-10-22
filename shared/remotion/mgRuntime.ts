import React, { createElement, useState, type ComponentProps, type ComponentType } from "react";
import { AbsoluteFill, Easing, Img as RemotionImg, interpolate, interpolateColors, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { MgItem } from "./mgProtocol";

type Mg = ComponentType<{ item: MgItem }>;

// Remotion's <Img> cancels the whole render when a source never loads; an MG's broken image draws a marker instead.
// Unmounting the failed <Img> releases its delayRender handle.
function Img(props: ComponentProps<typeof RemotionImg>) {
  const [broken, setBroken] = useState(false);
  if (broken) return createElement("div", { style: { ...props.style, background: "rgba(255,0,0,.85)", color: "white", fontSize: 18, fontFamily: "system-ui, sans-serif" } }, "⚠ image");
  return createElement(RemotionImg, { ...props, onError: () => setBroken(true) });
}

// The only names the compiled code can see (the server already rejected imports and denied globals).
export const MG_SCOPE = { React, AbsoluteFill, Img, Easing, interpolate, interpolateColors, random, spring, useCurrentFrame, useVideoConfig };

export function MgPlaceholder({ id }: { id: string }) {
  return createElement("div", {
    style: { position: "absolute", left: 0, top: 0, padding: "4px 10px", fontSize: 24, fontFamily: "system-ui, sans-serif", color: "white", background: "rgba(255,0,0,.85)" },
  }, `⚠ ${id}`);
}

// Stands in for code that throws while being evaluated or defines no component; render_frame then shows the problem.
export const MgBroken: Mg = () => createElement(MgPlaceholder, { id: "motion graphic" });

const CACHE_MAX = 50;
const cache = new Map<string, Mg>();

// Runs only in Chrome (Remotion render, still frames, browser Player) — never on the server.
export function buildMotionGraphic(compiled: string): Mg {
  const hit = cache.get(compiled);
  if (hit) return hit;
  let mg: Mg = MgBroken;
  try {
    const made: unknown = new Function(...Object.keys(MG_SCOPE), `"use strict";\n${compiled}\nreturn Component;`)(...Object.values(MG_SCOPE));
    if (typeof made === "function") mg = made as Mg;
  } catch { /* MgBroken */ }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(compiled, mg);
  return mg;
}
