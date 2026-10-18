import type { z } from "zod";
import type { AspectRatio, AssetSchema, CreateProjectInput, JobStateSchema, MediaSource, ProjectEventSchema, ProjectSchema, ProjectStatus, TranscriptSchema, WordSchema } from "./contract";

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
export interface Phrase { id: string; startMs: number; endMs: number; words: Word[]; lineBreaksAfter: number[] }
export interface CaptionLayout { maxCharsPerLine: number; maxWordsPerLine: number; maxLines: number; pauseSplitMs: number }
export interface CaptionTemplate {
  id: string;
  name: string;
  font: { family: string; weight: number; sizePx: number };
  colors: { text: string; activeWord: string; background?: string };
  position: { y: number }; // 0..1 from the top
  layout: CaptionLayout;
  animation: "karaoke" | "none";
  uppercase: boolean;
}
export type ShotKind = "Hook" | "B-Roll" | "Talking Head" | "Talking Head & B-Roll";
export interface Shot { id: string; kind: ShotKind; startMs: number; endMs: number }
export interface BrollBeat { id: string; shotId: string; startMs: number; endMs: number; intent: string; imagePrompt: string; stockQuery: string }
