import type { Services } from "../../shared/types";
import type { AppDeps } from "../shared/deps";

export const SERVICES_TTL_MS = 30_000;

// Spec row 32: local probes (whisperX, Ollama) in parallel, memoised so the web's 10 s health poll costs one probe per 30 s;
// Pexels and fal by key presence only — the hint never reaches a third party. The memo holds the promise, so concurrent polls share one probe.
export function servicesProbe(deps: Pick<AppDeps, "transcriber" | "llm" | "stock" | "generator" | "now">): () => Promise<Services> {
  let last: { at: number; value: Promise<Services> } | null = null;
  return () => {
    const now = deps.now().getTime();
    if (!last || now - last.at >= SERVICES_TTL_MS) {
      last = {
        at: now,
        value: Promise.all([deps.transcriber.health(), deps.llm.health()]).then(([whisperx, llm]) => ({
          whisperx, ollama: llm.status, ollamaModel: llm.model, stock: deps.stock ? "ok" : "unset", generator: deps.generator ? "ok" : "unset",
        })),
      };
    }
    return last.value;
  };
}
