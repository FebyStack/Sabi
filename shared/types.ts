import type { z } from "zod";
import type {
  ActionSchema, ApplyActionsInput, BrandFont, CaptionStyleSchema, RenderInput, ApplyActionsResult, AspectRatio, AssetSchema, BeatSchema, BoxSchema, BrandKitSchema, MotionGraphicInput, MotionGraphicPatch, MotionGraphicPropSchema, MotionGraphicSchema, BrollInput, OverlayMedia, OverlayPlacement, OverlaySchema, CreateProjectInput, CutSchema, EditPlanSchema, EmphasisKind, JobStateSchema, MediaSource, PhraseSchema, PlanInput,
  ProjectEventSchema, ProjectSchema, ProjectStatus, ShotKind, ShotSchema, TranscriptSchema, TranslationLanguage, TranslationSchema, UpdatePlanInput, WordSchema,
} from "./contract";

export type Asset = z.infer<typeof AssetSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
export type AspectRatio = z.infer<typeof AspectRatio>;
export type MediaSource = z.infer<typeof MediaSource>;
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

// Pipeline domain types (filled in as modules land; see docs/blueprint §10.4)
export type Word = z.infer<typeof WordSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Phrase = z.infer<typeof PhraseSchema>;
export type EmphasisKind = z.infer<typeof EmphasisKind>;
export type Cut = z.infer<typeof CutSchema>;
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type Translation = z.infer<typeof TranslationSchema>;
export type TranslationLanguage = z.infer<typeof TranslationLanguage>;
export type PlanInput = z.input<typeof PlanInput>;
export type UpdatePlanInput = z.input<typeof UpdatePlanInput>;
export type Action = z.infer<typeof ActionSchema>;
export type ApplyActionsInput = z.input<typeof ApplyActionsInput>;
export type ApplyActionsResult = z.infer<typeof ApplyActionsResult>;
export interface CaptionLayout { maxCharsPerLine: number; maxWordsPerLine: number; maxLines: number; pauseSplitMs: number }
export interface CaptionTemplate {
  id: string;
  name: string;
  font: { family: string; weight: number; sizePx: number };
  colors: { text: string; activeWord: string; background?: string; emphasis: Record<EmphasisKind, string> };
  position: { y: number }; // 0..1 from the top
  layout: CaptionLayout;
  animation: "karaoke" | "none";
  uppercase: boolean;
}
export type ShotKind = z.infer<typeof ShotKind>;
export type Shot = z.infer<typeof ShotSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type OverlayPlacement = z.infer<typeof OverlayPlacement>;
export type OverlayMedia = z.infer<typeof OverlayMedia>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type BrollInput = z.input<typeof BrollInput>;
export type BrandKit = z.infer<typeof BrandKitSchema>;
export type BrandFont = z.infer<typeof BrandFont>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type RenderInput = z.input<typeof RenderInput>;
export type MotionGraphic = z.infer<typeof MotionGraphicSchema>;
export type MotionGraphicProp = z.infer<typeof MotionGraphicPropSchema>;
export type MotionGraphicInput = z.input<typeof MotionGraphicInput>;
export type MotionGraphicPatch = z.input<typeof MotionGraphicPatch>;
export type Box = z.infer<typeof BoxSchema>;
