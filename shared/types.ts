import type { z } from "zod";
import type {
  AspectRatio, AssetSchema, CreateProjectInput, CutSchema, EditPlanSchema, EmphasisKind, JobStateSchema, MediaSource, PhraseSchema, PlanInput,
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
export interface BrollBeat { id: string; shotId: string; startMs: number; endMs: number; intent: string; imagePrompt: string; stockQuery: string }
