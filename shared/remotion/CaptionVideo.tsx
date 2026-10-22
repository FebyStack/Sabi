import { AbsoluteFill, Audio, OffthreadVideo, Series, Video, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from "remotion";
import { gradeStyles, type BrandLook } from "../editing/brand";
import type { Segment } from "../editing/cuts";
import type { MotionGraphicProps, OverlayProps } from "../editing/overlays";
import type { CaptionTemplate, Phrase } from "../types";
import { activeWordIndex, phraseAt, segmentFrames } from "./activeWord";
import { CaptionBlock } from "./CaptionBlock";
import { useFontsReady } from "./fonts";
import { MotionGraphicLayer } from "./MotionGraphicLayer";
import { OverlayLayer } from "./OverlayLayer";

export type CaptionVideoProps = {
  videoSrc: string;
  sourceKind: "video" | "audio"; // audio-only sources play on black
  phrases: Phrase[];
  template: CaptionTemplate;
  width: number;
  height: number;
  durationMs: number;
  segments?: Segment[]; // kept source ranges when cuts are enabled; phrases are already in output time
  brand: BrandLook;
  overlays: OverlayProps[]; // output time, like phrases
  motionGraphics: MotionGraphicProps[]; // output time
};

export const FPS = 30;

// Layers, back to front: footage → B-roll overlays → brand tint → motion graphics → captions. The grade touches only the first two.
export function CaptionVideo({ videoSrc, sourceKind, phrases, template, segments, brand, overlays, motionGraphics }: CaptionVideoProps) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const grade = gradeStyles(brand);
  const timeMs = (frame / fps) * 1000;
  const phrase = phraseAt(phrases, timeMs);
  const active = phrase ? activeWordIndex(phrase, timeMs) : -1;
  const Src = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
  const media = sourceKind === "audio" ? <Audio src={videoSrc} /> : <Src src={videoSrc} style={{ width: "100%", height: "100%", objectFit: "cover", ...grade.footage }} />;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {segments ? (
        <Series>
          {segmentFrames(segments, fps).map((s, i) => (
            <Series.Sequence key={i} durationInFrames={s.durationInFrames} trimBefore={s.trimBefore}>{media}</Series.Sequence>
          ))}
        </Series>
      ) : media}
      {overlays.map((o) => <OverlayLayer key={o.id} overlay={o} footageStyle={grade.footage} />)}
      {grade.tint && <AbsoluteFill style={grade.tint} />}
      {motionGraphics.map((m) => <MotionGraphicLayer key={m.id} mg={m} brand={brand} width={width} height={height} />)}
      {phrase && <CaptionBlock phrase={phrase} template={template} activeIndex={active} height={height} />}
    </AbsoluteFill>
  );
}
