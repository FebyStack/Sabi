import type { CSSProperties } from "react";
import { AbsoluteFill, Img, Loop, OffthreadVideo, Sequence, Video, getRemotionEnvironment, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { OverlayProps } from "../editing/overlays";

const FADE_FRAMES = 10;
// The band a "top" overlay fills; captions sit at template.position.y ≥ 0.78, below it.
const TOP_BAND: CSSProperties = { position: "absolute", top: "6%", height: "49%", left: "4%", right: "4%", borderRadius: 16, overflow: "hidden" };
const cover: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

export const msToFrames = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

function OverlayMedia({ overlay, footageStyle, durationInFrames }: { overlay: OverlayProps; footageStyle: CSSProperties; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = durationInFrames < 2 * FADE_FRAMES
    ? interpolate(frame, [0, durationInFrames / 2, durationInFrames], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : interpolate(frame, [0, FADE_FRAMES, durationInFrames - FADE_FRAMES, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = overlay.transition === "fade" ? fade : 1;
  let media;
  if (overlay.media === "image") {
    const scale = interpolate(frame, [0, durationInFrames], [1, 1.08], { extrapolateRight: "clamp" }); // Ken Burns
    media = <Img src={overlay.src} style={{ ...cover, ...footageStyle, transform: `scale(${scale})` }} />;
  } else {
    const V = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
    const video = <V src={overlay.src} muted style={{ ...cover, ...footageStyle }} />;
    const clip = overlay.durationMs ? msToFrames(overlay.durationMs, fps) : 0;
    media = clip > 0 && clip < durationInFrames ? <Loop durationInFrames={clip}>{video}</Loop> : video;
  }
  return overlay.placement === "top"
    ? <div style={{ ...TOP_BAND, opacity }}>{media}</div>
    : <AbsoluteFill style={{ opacity }}>{media}</AbsoluteFill>;
}

// One B-roll overlay at its output-time range. footageStyle = the brand grade, shared with the base video.
export function OverlayLayer({ overlay, footageStyle }: { overlay: OverlayProps; footageStyle: CSSProperties }) {
  const { fps } = useVideoConfig();
  const from = msToFrames(overlay.startMs, fps);
  const durationInFrames = msToFrames(overlay.endMs, fps) - from;
  if (durationInFrames <= 0) return null;
  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none">
      <OverlayMedia overlay={overlay} footageStyle={footageStyle} durationInFrames={durationInFrames} />
    </Sequence>
  );
}
