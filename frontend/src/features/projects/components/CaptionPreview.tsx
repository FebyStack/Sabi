import { Player } from "@remotion/player";
import { CaptionVideo, FPS } from "@shared/remotion/CaptionVideo";
import { getCaptionTemplate } from "@shared/captions/templates";
import type { Project } from "@shared/types";

const DIMS = { "9:16": { width: 1080, height: 1920 }, "16:9": { width: 1920, height: 1080 } } as const;

export function CaptionPreview({ project, videoSrc, durationMs }: { project: Project; videoSrc: string; durationMs: number }) {
  const { width, height } = DIMS[project.aspectRatio];
  return (
    <Player
      component={CaptionVideo}
      inputProps={{ videoSrc, sourceKind: project.sourceKind ?? "video", phrases: project.phrases, template: getCaptionTemplate(project.captionTemplateId), width, height, durationMs }}
      durationInFrames={Math.max(1, Math.ceil((durationMs / 1000) * FPS))}
      fps={FPS}
      compositionWidth={width}
      compositionHeight={height}
      controls
      style={{ width: "100%", aspectRatio: `${width} / ${height}`, maxHeight: "70vh" }}
    />
  );
}
