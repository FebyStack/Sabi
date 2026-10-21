import { useSyncExternalStore } from "react";

// matchMedia as state; false on the server (static markup tests render the phone layout).
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (on) => { const m = window.matchMedia(query); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
