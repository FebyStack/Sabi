import type { ReactElement } from "react";
import { getCaptionTemplate } from "../captions/templates";
import { templateLook } from "../editing/brand";
import type { MotionGraphicProps } from "../editing/overlays";
import { MotionGraphicLayer } from "./MotionGraphicLayer";

vi.mock("remotion", async (orig) => ({ ...(await orig<typeof import("remotion")>()), useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920 }) }));

const mg = (compiled: string): MotionGraphicProps => ({ id: "mg-0", compiled, startMs: 0, endMs: 1000, box: { x: 0, y: 0, w: 1, h: 1 }, props: {} });
// Sequence → box div → error boundary
const boundaryKey = (m: MotionGraphicProps) => {
  const seq = MotionGraphicLayer({ mg: m, brand: templateLook(getCaptionTemplate("clean")), width: 1080, height: 1920 }) as ReactElement<{ children: ReactElement<{ children: ReactElement }> }>;
  return seq.props.children.props.children.key;
};

describe("MotionGraphicLayer", () => {
  it("a code fix remounts the error boundary, so the preview drops the ⚠", () => {
    const broken = "const Component = () => { throw new Error('x'); };";
    const fixed = "const Component = () => null;";
    expect(boundaryKey(mg(broken))).not.toBe(boundaryKey(mg(fixed)));
    expect(boundaryKey(mg(fixed))).toBe(boundaryKey(mg(fixed)));
  });

  it("motion graphics get the bundled font's css family", () => {
    const seq = MotionGraphicLayer({ mg: mg("const Component = () => null;"), brand: { ...templateLook(getCaptionTemplate("clean")), fontFamily: "Montserrat" }, width: 1080, height: 1920 }) as ReactElement<{ children: ReactElement<{ children: ReactElement<{ children: ReactElement<{ item: { brand: { fontFamily: string } } }> }> }> }>;
    expect(seq.props.children.props.children.props.children.props.item.brand.fontFamily).toBe("Montserrat Variable");
  });
});
