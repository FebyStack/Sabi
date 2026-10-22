import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandLook } from "../editing/brand";
import type { MotionGraphicProps } from "../editing/overlays";
import { fontCssFamily } from "./fonts";
import { MgView, buildMotionGraphic } from "./mgRuntime";
import { msToFrames } from "./OverlayLayer";

export function MotionGraphicLayer({ mg, brand, width, height }: { mg: MotionGraphicProps; brand: BrandLook; width: number; height: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const from = msToFrames(mg.startMs, fps);
  const durationInFrames = msToFrames(mg.endMs, fps) - from;
  if (durationInFrames <= 0) return null;
  const Mg = buildMotionGraphic(mg.compiled);
  const box = { left: mg.box.x * width, top: mg.box.y * height, width: mg.box.w * width, height: mg.box.h * height };
  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none">
      <div style={{ position: "absolute", ...box, overflow: "hidden" }}>
        {/* new code → fresh boundary, so a fixed MG drops its ⚠ in the Player; fontFamily is the bundled CSS family */}
        <MgView key={mg.compiled} mg={Mg} id={mg.id} frame={frame - from} report={() => {}} track={() => {}}
          config={{ id: "CaptionVideo", width, height, fps, durationInFrames }}
          item={{ props: mg.props, brand: { ...brand, fontFamily: fontCssFamily(brand.fontFamily) }, width: box.width, height: box.height, durationInFrames }} />
      </div>
    </Sequence>
  );
}
