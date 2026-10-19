// Single wire contract shared by frontend and backend. Never mirror per tier.
import { z } from "zod";

export const AspectRatio = z.enum(["9:16", "16:9"]);
export const MediaSource = z.enum(["generate", "stock"]); // per-project: fal.ai generation or Pexels stock only
export const ProjectStatus = z.enum(["draft", "transcribing", "planning", "generating", "rendering", "ready", "failed"]);

export const CAPTION_TEMPLATE_IDS = ["clean", "bold", "karaoke"] as const;
export const CaptionTemplateId = z.enum(CAPTION_TEMPLATE_IDS);

export const EmphasisKind = z.enum(["noun", "keyword", "pictorial"]);
export const SHOT_KINDS = ["Hook", "B-Roll", "Talking Head", "Talking Head & B-Roll"] as const;
export const ShotKind = z.enum(SHOT_KINDS);

export const WordSchema = z.object({ id: z.string(), text: z.string(), startMs: z.number(), endMs: z.number(), confidence: z.number().optional(), emphasis: EmphasisKind.optional() });
export const PhraseSchema = z.object({ id: z.string(), startMs: z.number(), endMs: z.number(), words: z.array(WordSchema).min(1), lineBreaksAfter: z.array(z.number()), emoji: z.string().max(16).optional() });
export const TranscriptSchema = z.object({ language: z.string(), words: z.array(WordSchema) });

export const CutSchema = z.object({ id: z.string(), startMs: z.number(), endMs: z.number(), reason: z.enum(["pause", "filler"]), text: z.string(), shouldTrim: z.boolean() });
export const ShotSchema = z.object({ id: z.string(), kind: ShotKind, startMs: z.number(), endMs: z.number() });
export const EditPlanSchema = z.object({ cuts: z.array(CutSchema), shots: z.array(ShotSchema) });

export const LANGUAGE_NAMES = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian",
  ja: "Japanese", ko: "Korean", zh: "Chinese (Simplified)", hi: "Hindi", tl: "Tagalog", id: "Indonesian",
} as const;
export const TranslationLanguage = z.enum(Object.keys(LANGUAGE_NAMES) as [keyof typeof LANGUAGE_NAMES, ...(keyof typeof LANGUAGE_NAMES)[]]);
export const TranslationSchema = z.object({ language: TranslationLanguage, phrases: z.array(PhraseSchema) });

export const OverlayPlacement = z.enum(["full", "top"]);
export const OverlayMedia = z.enum(["image", "video"]);
export const OverlaySource = z.enum(["stock", "generated", "uploaded"]);
export const OverlayTransition = z.enum(["fade", "none"]);
export const AttributionSchema = z.object({ author: z.string(), url: z.string().url() });
export const GenerationInfoSchema = z.object({ provider: z.literal("fal"), model: z.string(), prompt: z.string(), costCents: z.number().int().nonnegative() });
// Stored in source time; captionVideoProps() maps it through enabled cuts.
export const OverlaySchema = z.object({
  id: z.string(), shotId: z.string(), assetId: z.string(), media: OverlayMedia, source: OverlaySource,
  startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), placement: OverlayPlacement,
  transition: OverlayTransition.default("fade"), enabled: z.boolean().default(true),
  query: z.string().max(200), prompt: z.string().max(600), intent: z.string().max(200),
  attribution: AttributionSchema.optional(), generationInfo: GenerationInfoSchema.optional(),
}).refine((o) => o.endMs > o.startMs, { message: "bad_range", path: ["endMs"] });

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  aspectRatio: AspectRatio,
  mediaSource: MediaSource,
  status: ProjectStatus,
  sourceAssetId: z.string().nullable(),
  sourceKind: z.enum(["video", "audio"]).nullable(),
  language: z.string().nullable(),
  captionTemplateId: CaptionTemplateId,
  transcript: TranscriptSchema.nullable(),
  phrases: z.array(PhraseSchema),
  outputs: z.object({
    mp4AssetId: z.string().optional(), srtAssetId: z.string().optional(), vttAssetId: z.string().optional(),
    translations: z.array(z.object({ language: TranslationLanguage, srtAssetId: z.string(), vttAssetId: z.string() })).optional(),
  }),
  warnings: z.array(z.string()),
  sourceDurationMs: z.number().nullable(),
  editPlan: EditPlanSchema.nullable(),
  translations: z.array(TranslationSchema),
  burnInLanguage: TranslationLanguage.nullable(),
  overlays: z.array(OverlaySchema).default([]),
  creditsUsedCents: z.number().int().nonnegative().default(0), // fal.ai spend ledger (spec §11.9), no billing
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SetSourceInput = z.object({ assetId: z.string().min(1) });
export const RunInput = z.object({ language: z.string().min(2).max(8).optional() });
export const UpdatePhrasesInput = z.object({ phrases: z.array(PhraseSchema) });
export const UpdateTemplateInput = z.object({ captionTemplateId: CaptionTemplateId });
export const PlanInput = z
  .object({ languages: z.array(TranslationLanguage).max(3).default([]), burnInLanguage: TranslationLanguage.nullable().default(null) })
  .refine((v) => v.burnInLanguage === null || v.languages.includes(v.burnInLanguage), { message: "burn_in_not_translated", path: ["burnInLanguage"] });
export const UpdatePlanInput = z.object({
  cuts: z.array(z.object({ id: z.string(), shouldTrim: z.boolean() })).default([]),
  shots: z.array(z.object({ id: z.string(), kind: ShotKind })).default([]),
  burnInLanguage: TranslationLanguage.nullable().optional(),
});

export const UpdateProjectInput = z.object({ mediaSource: MediaSource });
export const BrollInput = z.object({ regenerate: z.boolean().default(false) });
export const UpdateOverlaysInput = z.object({
  overlays: z.array(z.object({
    id: z.string(), enabled: z.boolean().optional(), startMs: z.number().int().nonnegative().optional(), endMs: z.number().int().positive().optional(),
    placement: OverlayPlacement.optional(), transition: OverlayTransition.optional(),
  })).min(1),
});
export const ReplaceOverlayInput = z.object({ assetId: z.string().min(1) });
export const RegenerateOverlayInput = z.object({ query: z.string().max(200).optional(), prompt: z.string().max(600).optional() });

export const CreateProjectInput = z.object({
  title: z.string().min(1).max(200),
  aspectRatio: AspectRatio.default("9:16"),
  mediaSource: MediaSource.default("generate"),
});

export const HealthSchema = z.object({ ok: z.literal(true), time: z.string() });

export const AssetKind = z.enum(["video", "audio", "image", "render", "subtitle"]);
export const AssetSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  kind: AssetKind,
  key: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  durationMs: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  createdAt: z.string(),
});

export const UPLOAD_LIMITS = {
  maxBytes: 2 * 1024 ** 3,
  mimeTypes: ["video/mp4", "video/quicktime", "audio/mpeg", "audio/wav"],
} as const;
export const MAX_CLIP_MS = 10 * 60_000;

export const UploadStartInput = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});

export const JobStateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.string(),
  state: z.enum(["QUEUED", "PROCESSING", "COMPLETE", "FAILED"]),
  progress: z.number(),
  stage: z.string().optional(),
  error: z.string().optional(),
});

export const ProjectEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("job"), job: JobStateSchema }),
  z.object({ type: z.literal("project"), status: ProjectStatus }),
]);

export const api = {
  health: "/api/health",
  projects: "/api/projects",
  project: (id: string) => `/api/projects/${id}`,
  projectEvents: (id: string) => `/api/projects/${id}/events`,
  projectSource: (id: string) => `/api/projects/${id}/source`,
  projectRun: (id: string) => `/api/projects/${id}/run`,
  projectPhrases: (id: string) => `/api/projects/${id}/phrases`,
  projectTemplate: (id: string) => `/api/projects/${id}/template`,
  projectPlan: (id: string) => `/api/projects/${id}/plan`,
  projectUpdate: (id: string) => `/api/projects/${id}`,
  projectBroll: (id: string) => `/api/projects/${id}/broll`,
  projectOverlay: (id: string, overlayId: string) => `/api/projects/${id}/broll/${overlayId}`,
  projectOverlayReplace: (id: string, overlayId: string) => `/api/projects/${id}/broll/${overlayId}/replace`,
  projectOverlayRegenerate: (id: string, overlayId: string) => `/api/projects/${id}/broll/${overlayId}/regenerate`,
  uploadsStart: "/api/assets/uploads/start",
  upload: (uploadId: string) => `/api/assets/uploads/${uploadId}`,
  uploadDone: (uploadId: string) => `/api/assets/uploads/${uploadId}/done`,
  assetFile: (id: string) => `/api/assets/${id}/file`,
} as const;
