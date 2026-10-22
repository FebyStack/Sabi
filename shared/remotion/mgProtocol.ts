import { MgProblemSchema } from "../contract";
import type { BrandLook } from "../editing/brand";
import type { MgProblem } from "../types";

// The page ⇄ sandbox protocol for motion graphics (spec row 24). The sandbox page imports only the types.
export const MG_START_MS = 15_000; // a sandbox not ready by then draws ⚠ (not 5 s: a busy render machine must not bake ⚠ into an export)
export const MG_FRAME_MS = 5_000; // a frame not answered by then draws ⚠
export const MG_LOG_PREFIX = "sabi:mg ";
const MAX_DETAIL = 200;

// What an agent-written motion graphic receives. width/height are its box in pixels; frames count from its own start.
export type MgItem = { props: Record<string, string | number | boolean>; brand: BrandLook; width: number; height: number; durationInFrames: number };
export type FontPayload = { css: string; files: Blob[] };
export type ToSandbox =
  | { t: "init"; id: string; compiled: string; fps: number; width: number; height: number; fonts: FontPayload; images: [string, Blob][] }
  | { t: "draw"; seq: number; frame: number | null; item: MgItem };
export type FromSandbox = { t: "ready" } | { t: "drawn"; seq: number } | { t: "problem"; kind: "threw" | "image" | "blocked"; detail: string };

// Whatever the sandbox posts is untrusted: only these shapes pass, and details are cut.
export function parseFromSandbox(data: unknown): FromSandbox | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.t === "ready") return { t: "ready" };
  if (m.t === "drawn" && Number.isInteger(m.seq)) return { t: "drawn", seq: m.seq as number };
  if (m.t === "problem" && (m.kind === "threw" || m.kind === "image" || m.kind === "blocked") && typeof m.detail === "string")
    return { t: "problem", kind: m.kind, detail: m.detail.slice(0, MAX_DETAIL) };
  return null;
}

export const mgLogLine = (p: MgProblem) => MG_LOG_PREFIX + JSON.stringify(p);

export function parseMgLog(text: string): MgProblem | null {
  if (!text.startsWith(MG_LOG_PREFIX)) return null;
  try {
    const r = MgProblemSchema.safeParse(JSON.parse(text.slice(MG_LOG_PREFIX.length)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// The render browser's console carries problems to the server (Remotion's onBrowserLog), each once per page.
const logged = new Set<string>();
export function logMgProblem(p: MgProblem): void {
  const line = mgLogLine({ ...p, detail: p.detail.slice(0, MAX_DETAIL) });
  if (logged.has(line)) return;
  logged.add(line);
  console.warn(line);
}

// Safe as an HTTP header value: at most 10 problems, every char past U+007E escaped (Node refuses non-ASCII headers).
export const mgProblemsHeader = (ps: MgProblem[]): string =>
  JSON.stringify(ps.slice(0, 10).map((p) => ({ ...p, detail: p.detail.slice(0, MAX_DETAIL) })))
    .replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
