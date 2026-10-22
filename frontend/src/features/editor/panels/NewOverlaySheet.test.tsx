import { renderToStaticMarkup } from "react-dom/server";
import type { Overlay } from "@shared/types";
import { NewOverlaySheet, newOverlayInput } from "./NewOverlaySheet";

const ov = (extra: Partial<Overlay> = {}): Overlay => ({
  id: "ov-1", shotId: "shot-1", assetId: "a", media: "image", source: "stock", startMs: 4000, endMs: 6000, placement: "full", transition: "fade", enabled: true,
  query: "kettle on a stove", prompt: "a steaming kettle, morning light", intent: "", ...extra,
});
const sheet = (mediaSource: "generate" | "stock", overlay: Overlay) =>
  renderToStaticMarkup(<NewOverlaySheet mediaSource={mediaSource} overlay={overlay} busy={false} onClose={() => {}} onGenerate={() => {}} />);

describe("NewOverlaySheet", () => {
  it("generate mode asks for a prompt and names the cost", () => {
    const html = sheet("generate", ov());
    expect(html).toMatch(/<label[^>]*>Prompt<\/label>|>Prompt</);
    expect(html).toContain('value="a steaming kettle, morning light"');
    expect(html).toContain("1 ¢");
    expect(sheet("generate", ov({ media: "video" }))).toContain("25 ¢");
  });

  it("stock mode searches Pexels for free", () => {
    const html = sheet("stock", ov());
    expect(html).toContain(">Search Pexels<");
    expect(html).toContain('value="kettle on a stove"');
    expect(html).not.toContain("¢");
  });

  it("builds the generate request for that overlay", () => {
    expect(newOverlayInput("generate", ov(), "  a kettle  ")).toEqual({ source: "generate", media: "image", prompt: "a kettle", overlayId: "ov-1" });
    expect(newOverlayInput("stock", ov({ media: "video" }), "kettle")).toEqual({ source: "stock", media: "video", query: "kettle", overlayId: "ov-1" });
  });
});
