import React, { createElement, type ComponentType } from "react";
import { AbsoluteFill, Easing, Img, interpolate, interpolateColors, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandLook } from "../editing/brand";

// What an agent-written motion graphic receives. width/height are its box in pixels; frames count from its own start.
export type MgItem = { props: Record<string, string | number | boolean>; brand: BrandLook; width: number; height: number; durationInFrames: number };
type Mg = ComponentType<{ item: MgItem }>;

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
