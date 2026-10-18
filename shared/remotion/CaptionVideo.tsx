import { AbsoluteFill, Audio, OffthreadVideo, Video, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionTemplate, Phrase } from "../types";
import { activeWordIndex, phraseAt } from "./activeWord";

export type CaptionVideoProps = {
  videoSrc: string;
  sourceKind: "video" | "audio"; // audio-only sources play on black
  phrases: Phrase[];
  template: CaptionTemplate;
  width: number;
  height: number;
  durationMs: number;
};

export const FPS = 30;

export function CaptionVideo({ videoSrc, sourceKind, phrases, template }: CaptionVideoProps) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const timeMs = (frame / fps) * 1000;
  const phrase = phraseAt(phrases, timeMs);
  const active = phrase ? activeWordIndex(phrase, timeMs) : -1;
  const Src = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {sourceKind === "audio" ? <Audio src={videoSrc} /> : <Src src={videoSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      {phrase && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: height * template.position.y - template.font.sizePx }}>
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
                <span style={{ color: template.animation === "karaoke" && i === active ? template.colors.activeWord : template.colors.text }}>{w.text}</span>
                {phrase.lineBreaksAfter.includes(i) ? <br /> : " "}
              </span>
            ))}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
