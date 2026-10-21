import { AbsoluteFill } from "remotion";
import type { CaptionTemplate, Phrase } from "../types";
import { wordColor } from "./activeWord";
import { fontStack } from "./fonts";

// The caption block of CaptionVideo; the Style panel's preset cards reuse it.
export function CaptionBlock({ phrase, template, activeIndex, height }: { phrase: Phrase; template: CaptionTemplate; activeIndex: number; height: number }) {
  const emojiPx = template.font.sizePx * 1.2;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: height * template.position.y - template.font.sizePx - emojiPx }}>
      {/* Always laid out, so the caption block does not jump between phrases with and without an emoji. */}
      <div style={{ height: emojiPx, fontSize: emojiPx, lineHeight: 1 }}>{phrase.emoji}</div>
      <div
        style={{
          fontFamily: fontStack(template.font.family),
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
            <span style={{ color: wordColor(template, w, i === activeIndex) }}>{w.text}</span>
            {phrase.lineBreaksAfter.includes(i) ? <br /> : " "}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}
