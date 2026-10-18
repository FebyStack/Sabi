import { Composition } from "remotion";
import { CaptionVideo, FPS, type CaptionVideoProps } from "./CaptionVideo";
import { getCaptionTemplate } from "../captions/templates";

const defaults: CaptionVideoProps = {
  videoSrc: "", sourceKind: "video", phrases: [], template: getCaptionTemplate("clean"), width: 1080, height: 1920, durationMs: 1000,
};

export function Root() {
  return (
    <Composition
      id="CaptionVideo"
      component={CaptionVideo}
      fps={FPS}
      width={defaults.width}
      height={defaults.height}
      durationInFrames={30}
      defaultProps={defaults}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        durationInFrames: Math.max(1, Math.ceil((props.durationMs / 1000) * FPS)),
      })}
    />
  );
}
