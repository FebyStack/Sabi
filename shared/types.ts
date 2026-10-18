import type { z } from "zod";
import type { AspectRatio, AssetSchema, CreateProjectInput, JobStateSchema, MediaSource, ProjectEventSchema, ProjectSchema, ProjectStatus } from "./contract";

export type Asset = z.infer<typeof AssetSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
export type AspectRatio = z.infer<typeof AspectRatio>;
export type MediaSource = z.infer<typeof MediaSource>;
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

// Pipeline domain types (filled in as modules land; see docs/blueprint §10.4)
export interface Word { id: string; text: string; startMs: number; endMs: number; confidence?: number }
export interface Phrase { id: string; startMs: number; endMs: number; words: Word[] }
export type ShotKind = "Hook" | "B-Roll" | "Talking Head" | "Talking Head & B-Roll";
export interface Shot { id: string; kind: ShotKind; startMs: number; endMs: number }
export interface BrollBeat { id: string; shotId: string; startMs: number; endMs: number; intent: string; imagePrompt: string; stockQuery: string }
