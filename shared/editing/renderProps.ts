import { getCaptionTemplate } from "../captions/templates";
import type { CaptionVideoProps } from "../remotion/CaptionVideo";
import type { Cut, Phrase, Project, TranslationLanguage } from "../types";
import { applyCuts, keptSegments } from "./cuts";

export const DIMS = { "9:16": { width: 1080, height: 1920 }, "16:9": { width: 1920, height: 1080 } } as const;

export const enabledCuts = (project: Project): Cut[] => project.editPlan?.cuts.filter((c) => c.shouldTrim) ?? [];

// One mapping for the server render and the browser preview, so preview = export. Edits are stored in source time.
export function captionVideoProps(project: Project, opts: { videoSrc: string; sourceDurationMs: number }): CaptionVideoProps {
  const cuts = enabledCuts(project);
  const burnIn = project.translations.find((t) => t.language === project.burnInLanguage);
  const props: CaptionVideoProps = {
    videoSrc: opts.videoSrc,
    sourceKind: project.sourceKind ?? "video",
    phrases: applyCuts(burnIn?.phrases ?? project.phrases, cuts, !burnIn), // translated words don't line up with source fillers
    template: getCaptionTemplate(project.captionTemplateId),
    ...DIMS[project.aspectRatio],
    durationMs: opts.sourceDurationMs,
  };
  if (!cuts.length) return props;
  const segments = keptSegments(opts.sourceDurationMs, cuts);
  return { ...props, segments, durationMs: segments.reduce((ms, s) => ms + s.endMs - s.startMs, 0) };
}

export function subtitleTracks(project: Project): { language: TranslationLanguage | null; phrases: Phrase[] }[] {
  const cuts = enabledCuts(project);
  return [
    { language: null, phrases: applyCuts(project.phrases, cuts) },
    ...project.translations.map((t) => ({ language: t.language, phrases: applyCuts(t.phrases, cuts, false) })),
  ];
}
