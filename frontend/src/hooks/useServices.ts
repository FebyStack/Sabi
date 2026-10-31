import { useQuery } from "@tanstack/react-query";
import type { Services } from "@shared/types";
import { getHealth } from "@/services/http";

// Spec row 32: what is missing before a click. One ["health"] query (shared with Home's api line), polled every 10 s.
export function useServices(): Services | undefined {
  return useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 10_000 }).data?.services;
}

// Home's one line; fal is left out (Generate is a per-project choice, the B-roll panel names it).
export function servicesLine(s: Services | undefined): string | null {
  if (!s) return null;
  const items = [
    s.whisperx === "down" && "whisperX off",
    s.ollama === "down" && "Ollama off",
    s.ollama === "model_missing" && "Ollama model missing",
    s.stock === "unset" && "Pexels key unset",
  ].filter(Boolean);
  return items.length ? items.join(" · ") : null;
}
