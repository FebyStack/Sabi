import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, type RefObject } from "react";
import { CaptionVideo, FPS } from "@shared/remotion/CaptionVideo";
import { captionVideoProps } from "@shared/editing/renderProps";
import type { Project } from "@shared/types";
import { assetFileUrl } from "@/features/projects/api/projects";

// Same props as the server render (cuts, burn-in, emphasis, emoji), so preview = export. `project` may carry a drag preview.
export function CaptionPreview({ project, videoSrc, durationMs, playerRef, onFrame }:
  { project: Project; videoSrc: string; durationMs: number; playerRef: RefObject<PlayerRef | null>; onFrame?: (frame: number) => void }) {
  const props = useMemo(() => captionVideoProps(project, { videoSrc, sourceDurationMs: durationMs, assetUrl: assetFileUrl }), [project, videoSrc, durationMs]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onFrame) return;
    const on = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
    player.addEventListener("frameupdate", on);
    return () => player.removeEventListener("frameupdate", on);
  }, [playerRef, onFrame]);
  return (
    <Player
      ref={playerRef}
      component={CaptionVideo}
      inputProps={props}
      durationInFrames={Math.max(1, Math.ceil((props.durationMs / 1000) * FPS))}
      fps={FPS}
      compositionWidth={props.width}
      compositionHeight={props.height}
      controls
      style={{ width: "100%", aspectRatio: `${props.width} / ${props.height}`, maxHeight: "45vh" }}
    />
  );
}
