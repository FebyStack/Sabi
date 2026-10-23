import { createElement } from "react";

// The red label a broken motion graphic draws at its box's top-left: inside its sandbox when the code throws,
// in the page when the sandbox navigates away or stops answering.
export function MgPlaceholder({ id }: { id: string }) {
  return createElement("div", {
    style: { position: "absolute", left: 0, top: 0, padding: "4px 10px", fontSize: 24, fontFamily: "system-ui, sans-serif", color: "white", background: "rgba(255,0,0,.85)" },
  }, `⚠ ${id}`);
}
