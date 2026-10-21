import { AbsoluteFill, Audio, OffthreadVideo, Series, Video, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from "remotion";
import { gradeStyles, type BrandLook } from "../editing/brand";
import type { Segment } from "../editing/cuts";
import type { MotionGraphicProps, OverlayProps } from "../editing/overlays";
import type { CaptionTemplate, Phrase } from "../types";
import { activeWordIndex, phraseAt, segmentFrames, wordColor } from "./activeWord";
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
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const grade = gradeStyles(brand);
  const timeMs = (frame / fps) * 1000;
  const phrase = phraseAt(phrases, timeMs);
  const active = phrase ? activeWordIndex(phrase, timeMs) : -1;
  const Src = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
  const media = sourceKind === "audio" ? <Audio src={videoSrc} /> : <Src src={videoSrc} style={{ width: "100%", height: "100%", objectFit: "cover", ...grade.footage }} />;
  const emojiPx = template.font.sizePx * 1.2;

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
      {phrase && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: height * template.position.y - template.font.sizePx - emojiPx }}>
          {/* Always laid out, so the caption block does not jump between phrases with and without an emoji. */}
          <div style={{ height: emojiPx, fontSize: emojiPx, lineHeight: 1 }}>{phrase.emoji}</div>
          <div
            style={{
              fontFamily: `${template.font.family}, system-ui, sans-serif`,
              fontWeight: template.font.weight,
              fontSize: template.font.sizePx,
              lineHeight: 1.15,
              color: template.colors.text,
              textAlign: "center",
              textTransform: template.uppercase ? "uppercase" : "none",
              textShadow: "0 2px 12px rgba(0,0,0,.8)",
              background: template.colors.background,
              padding: template.colors.background ? "0.2em 0.5em" : 0,
              borderRadius: 16,
              maxWidth: "90%",
            }}
          >
            {phrase.words.map((w, i) => (
              <span key={w.id}>
                <span style={{ color: wordColor(template, w, i === active) }}>{w.text}</span>
                {phrase.lineBreaksAfter.includes(i) ? <br /> : " "}
              </span>
            ))}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
