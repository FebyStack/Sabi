import { Component as ReactComponent, type ReactNode } from "react";
import { Sequence, useVideoConfig } from "remotion";
import type { BrandLook } from "../editing/brand";
import type { MotionGraphicProps } from "../editing/overlays";
import { MgBroken, MgPlaceholder, buildMotionGraphic } from "./mgRuntime";
import { msToFrames } from "./OverlayLayer";

// A motion graphic that throws while rendering draws its placeholder instead of failing the frame or the MP4.
class MgBoundary extends ReactComponent<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <MgPlaceholder id={this.props.id} /> : this.props.children; }
}

export function MotionGraphicLayer({ mg, brand, width, height }: { mg: MotionGraphicProps; brand: BrandLook; width: number; height: number }) {
  const { fps } = useVideoConfig();
  const from = msToFrames(mg.startMs, fps);
  const durationInFrames = msToFrames(mg.endMs, fps) - from;
  if (durationInFrames <= 0) return null;
  const Mg = buildMotionGraphic(mg.compiled);
  const box = { left: mg.box.x * width, top: mg.box.y * height, width: mg.box.w * width, height: mg.box.h * height };
  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none">
      <div style={{ position: "absolute", ...box, overflow: "hidden" }}>
        {Mg === MgBroken ? <MgPlaceholder id={mg.id} /> : (
          <MgBoundary id={mg.id}>
            <Mg item={{ props: mg.props, brand, width: box.width, height: box.height, durationInFrames }} />
          </MgBoundary>
        )}
      </div>
    </Sequence>
  );
}
