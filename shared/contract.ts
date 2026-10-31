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
// estimatedWords: words of segments whisperX could not align at all, so their timings were spread (absent when none).
export const TranscriptSchema = z.object({ language: z.string(), words: z.array(WordSchema), estimatedWords: z.number().int().nonnegative().optional() });

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
export const BeatSchema = z.object({ id: z.string(), shotId: z.string(), startMs: z.number(), endMs: z.number(), placement: OverlayPlacement, media: OverlayMedia });
// Stored in source time; captionVideoProps() maps it through enabled cuts.
export const OverlaySchema = z.object({
  id: z.string(), shotId: z.string(), assetId: z.string(), media: OverlayMedia, source: OverlaySource,
  startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), placement: OverlayPlacement,
  transition: OverlayTransition.default("fade"), enabled: z.boolean().default(true),
  query: z.string().max(200), prompt: z.string().max(600), intent: z.string().max(200),
  attribution: AttributionSchema.optional(), generationInfo: GenerationInfoSchema.optional(),
  durationMs: z.number().int().positive().optional(), // video overlays: the clip's own length, for looping
}).refine((o) => o.endMs > o.startMs, { message: "bad_range", path: ["endMs"] });

export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// Bundled OFL fonts (shared/remotion/fonts.ts): the Player and the render browser load the same files.
export const BRAND_FONTS = ["Inter", "Montserrat", "Poppins", "Bebas Neue", "Playfair Display", "Space Grotesk"] as const;
export const BrandFont = z.enum(BRAND_FONTS);
export const BrandKitSchema = z.object({
  palette: z.object({ primary: Hex, accent: Hex, text: Hex, background: Hex }),
  fontFamily: BrandFont,
  logoAssetId: z.string().nullable().default(null),
  grade: z.number().min(0).max(1).default(0.4),
});
// Per-project overrides on top of the caption template and the brand kit; absent keys keep the template's value.
export const CaptionStyleSchema = z.object({
  fontFamily: BrandFont.optional(), sizePx: z.number().int().min(40).max(120).optional(), y: z.number().min(0.5).max(0.9).optional(),
  uppercase: z.boolean().optional(), weight: z.union([z.literal(400), z.literal(700), z.literal(900)]).optional(),
  background: z.boolean().optional(), animation: z.enum(["karaoke", "none"]).optional(),
});
export const MIN_SHOT_MS = 500;
export const MIN_PHRASE_MS = 200;
export const MAX_MG_CODE = 20_000;
export const MAX_MG_COMPILED = 60_000;
const PropKey = z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/);
export const MotionGraphicPropSchema = z.discriminatedUnion("type", [
  z.object({ key: PropKey, type: z.literal("text"), value: z.string().max(500) }),
  z.object({ key: PropKey, type: z.literal("number"), value: z.number() }),
  z.object({ key: PropKey, type: z.literal("color"), value: Hex }),
  z.object({ key: PropKey, type: z.literal("boolean"), value: z.boolean() }),
  z.object({ key: PropKey, type: z.literal("image"), value: z.string().min(1) }), // asset id of kind image
]);
const uniqueKeys = (ps: { key: string }[]) => new Set(ps.map((p) => p.key)).size === ps.length;
export const BoxSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.05).max(1), h: z.number().min(0.05).max(1) })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, { message: "out_of_frame" });
export const FULL_BOX = { x: 0, y: 0, w: 1, h: 1 } as const;
export const MotionGraphicInput = z.object({
  name: z.string().min(1).max(60), code: z.string().min(1).max(MAX_MG_CODE),
  startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
  box: BoxSchema.default(FULL_BOX), props: z.array(MotionGraphicPropSchema).max(20).refine(uniqueKeys, { message: "duplicate_key" }).default([]),
});
export const MotionGraphicPatch = z.object({ // no defaults: an absent key means "keep"
  name: z.string().min(1).max(60).optional(), code: z.string().min(1).max(MAX_MG_CODE).optional(),
  startMs: z.number().int().nonnegative().optional(), endMs: z.number().int().positive().optional(),
  box: BoxSchema.optional(), props: z.array(MotionGraphicPropSchema).max(20).refine(uniqueKeys, { message: "duplicate_key" }).optional(), enabled: z.boolean().optional(),
});
// Stored in source time; `compiled` is written by the server and executed only in Chrome (render, frames, Player).
export const MotionGraphicSchema = MotionGraphicInput.extend({ id: z.string(), compiled: z.string().max(MAX_MG_COMPILED), enabled: z.boolean().default(true) })
  .refine((m) => m.endMs > m.startMs, { message: "bad_range", path: ["endMs"] });
// Why an MG shows ⚠ or what its sandbox refused, as GET /frame reports it to the agent (spec row 26).
export const MG_PROBLEMS_HEADER = "x-sabi-mg-problems";
export const MgProblemSchema = z.object({ mg: z.string().max(40), kind: z.enum(["threw", "image", "blocked", "navigated", "silent"]), detail: z.string().max(200) });

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
    stale: z.boolean().optional(), // a visual edit landed after this render
    resolution: z.enum(["1080p", "4k"]).optional(),
  }),
  warnings: z.array(z.string()),
  sourceDurationMs: z.number().nullable(),
  editPlan: EditPlanSchema.nullable(),
  translations: z.array(TranslationSchema),
  burnInLanguage: TranslationLanguage.nullable(),
  overlays: z.array(OverlaySchema).default([]),
  creditsUsedCents: z.number().int().nonnegative().default(0), // fal.ai spend ledger (spec §11.9), no billing
  brand: BrandKitSchema.nullable().default(null),
  motionGraphics: z.array(MotionGraphicSchema).default([]),
  captionStyle: CaptionStyleSchema.nullable().default(null),
  demo: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SetSourceInput = z.object({ assetId: z.string().min(1) });
// language: force the spoken language; null = auto-detect again; absent = the project's last language.
export const RunInput = z.object({ language: z.string().min(2).max(8).nullable().optional() });
export const RenderInput = z.object({ scale: z.union([z.literal(1), z.literal(2)]).optional() }); // 2 = 4K; absent = the last export's resolution
export const PlanInput = z
  .object({ languages: z.array(TranslationLanguage).max(3).default([]), burnInLanguage: TranslationLanguage.nullable().default(null) })
  .refine((v) => v.burnInLanguage === null || v.languages.includes(v.burnInLanguage), { message: "burn_in_not_translated", path: ["burnInLanguage"] });
export const BrollInput = z.object({
  regenerate: z.boolean().default(false), overlayId: z.string().optional(), query: z.string().max(200).optional(), prompt: z.string().max(600).optional(),
});
// What one fal generation is ledgered at, in whole cents (flux/schnell's $0.003 rounds up); the web shows it before spending.
export const GENERATION_COST_CENTS = { image: 1, video: 25 } as const;
// One asset on demand (spec row 19): a fal generation from a prompt, or Pexels candidates for a query; overlayId swaps that overlay's media.
export const GenerateInput = z.object({
  source: MediaSource, media: OverlayMedia,
  prompt: z.string().trim().min(1).max(600).optional(), query: z.string().trim().min(1).max(200).optional(), overlayId: z.string().optional(),
}).refine((v) => (v.source === "generate" ? !!v.prompt : !!v.query), { message: "prompt_or_query" });
// Typed edits the agent (MCP) applies atomically; the same edits the web UI makes one at a time.
export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setTitle"), title: z.string().min(1).max(200) }),
  z.object({ type: z.literal("editPhrase"), phraseId: z.string(), text: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal("setCut"), cutId: z.string(), shouldTrim: z.boolean() }),
  z.object({ type: z.literal("setShotKind"), shotId: z.string(), kind: ShotKind }),
  z.object({ type: z.literal("setTemplate"), captionTemplateId: CaptionTemplateId }),
  z.object({ type: z.literal("setBurnIn"), language: TranslationLanguage.nullable() }),
  z.object({ type: z.literal("setMediaSource"), mediaSource: MediaSource }),
  z.object({ type: z.literal("setOverlay"), overlayId: z.string(), enabled: z.boolean().optional(), startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().positive().optional(), placement: OverlayPlacement.optional(), transition: OverlayTransition.optional() }),
  z.object({ type: z.literal("removeOverlay"), overlayId: z.string() }),
  z.object({ type: z.literal("replaceOverlay"), overlayId: z.string(), assetId: z.string().min(1) }),
  z.object({ type: z.literal("addOverlay"), assetId: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
    placement: OverlayPlacement.optional(), transition: OverlayTransition.optional() }),
  z.object({ type: z.literal("setBrand"), brand: BrandKitSchema.nullable() }),
  z.object({ type: z.literal("addMotionGraphic"), ...MotionGraphicInput.shape }),
  z.object({ type: z.literal("updateMotionGraphic"), mgId: z.string(), ...MotionGraphicPatch.shape }),
  z.object({ type: z.literal("removeMotionGraphic"), mgId: z.string() }),
  z.object({ type: z.literal("setShotBounds"), shotId: z.string(), startMs: z.number().int().nonnegative().optional(), endMs: z.number().int().positive().optional() }),
  z.object({ type: z.literal("retimePhraseRange"), phraseId: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }),
  z.object({ type: z.literal("setWordEmphasis"), phraseId: z.string(), wordId: z.string(), emphasis: EmphasisKind.nullable() }),
  z.object({ type: z.literal("setPhraseEmoji"), phraseId: z.string(), emoji: z.string().max(16).nullable() }),
  z.object({ type: z.literal("setCaptionStyle"), style: CaptionStyleSchema.nullable() }),
]);
export const MAX_ACTIONS = 50;
export const ApplyActionsInput = z.object({
  baseVersion: z.string(), // the project's updatedAt the caller last saw
  actions: z.array(ActionSchema).min(1).max(MAX_ACTIONS),
  render: z.boolean().default(false),
});
export const ApplyActionsResult = z.object({ project: ProjectSchema, applied: z.number(), jobId: z.string().optional() });

export const CreateProjectInput = z.object({
  title: z.string().min(1).max(200),
  aspectRatio: AspectRatio.default("9:16"),
  mediaSource: MediaSource.default("generate"),
});

// Spec row 32: what the web hints at before a click. stock/generator are key presence only.
export const ServicesSchema = z.object({
  whisperx: z.enum(["ok", "down"]), ollama: z.enum(["ok", "down", "model_missing"]), ollamaModel: z.string(),
  stock: z.enum(["ok", "unset"]), generator: z.enum(["ok", "unset"]),
});
export const HealthSchema = z.object({ ok: z.literal(true), time: z.string(), services: ServicesSchema });

export const AssetKind = z.enum(["video", "audio", "image", "render", "subtitle"]);
// Where B-roll media came from; overlays copy it when an asset is placed (absent = uploaded).
export const AssetMetaSchema = z.object({
  source: OverlaySource, attribution: AttributionSchema.optional(), generationInfo: GenerationInfoSchema.optional(),
  prompt: z.string().optional(), query: z.string().optional(),
});
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
  meta: AssetMetaSchema.optional(),
  createdAt: z.string(),
});

export const UPLOAD_LIMITS = {
  maxBytes: 2 * 1024 ** 3,
  maxImageBytes: 50 * 1024 ** 2,
  mimeTypes: ["video/mp4", "video/quicktime", "audio/mpeg", "audio/wav", "image/png", "image/jpeg", "image/webp"],
} as const;
export const MAX_CLIP_MS = 10 * 60_000;

export const UploadStartInput = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});

export const Actor = z.enum(["web", "agent"]); // who started a job: the web app, or the agent over MCP (attribution, not auth)
export const ACTOR_HEADER = "x-sabi-actor";
export const JobResultSchema = z.object({ assetIds: z.array(z.string()) });
export const JobStateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.string(),
  state: z.enum(["QUEUED", "PROCESSING", "COMPLETE", "FAILED"]),
  progress: z.number(),
  stage: z.string().optional(),
  error: z.string().optional(),
  result: JobResultSchema.optional(),
});

// Paid-generation spend (spec rows 19–20). Months are UTC calendar months; a deleted project's rows keep their id and lose their title.
const Cents = z.number().int().nonnegative();
export const CatalogSchema = z.object({
  models: z.array(z.object({ id: z.string(), provider: z.enum(["fal", "pexels"]), media: OverlayMedia, costCents: Cents, available: z.boolean() })),
  spend: z.object({ monthCents: Cents, capCents: Cents }), // capCents 0 = no cap
});
export const UsageRowSchema = z.object({
  id: z.string(), createdAt: z.string(), model: z.string(), media: OverlayMedia, costCents: Cents, jobKind: z.enum(["broll", "generate"]), actor: Actor,
  projectId: z.string().nullable(), projectTitle: z.string().nullable(),
});
export const UsageSchema = z.object({
  capCents: Cents, monthCents: Cents,
  months: z.array(z.object({ month: z.string(), totalCents: Cents, rows: z.array(UsageRowSchema) })), // newest first
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
  projectPlan: (id: string) => `/api/projects/${id}/plan`,
  projectBroll: (id: string) => `/api/projects/${id}/broll`,
  projectGenerate: (id: string) => `/api/projects/${id}/generate`,
  projectAssets: (id: string) => `/api/projects/${id}/assets`,
  projectFrame: (id: string) => `/api/projects/${id}/frame`,
  projectJob: (id: string) => `/api/projects/${id}/job`,
  projectActions: (id: string) => `/api/projects/${id}/actions`,
  projectRender: (id: string) => `/api/projects/${id}/render`,
  uploadsStart: "/api/assets/uploads/start",
  upload: (uploadId: string) => `/api/assets/uploads/${uploadId}`,
  uploadDone: (uploadId: string) => `/api/assets/uploads/${uploadId}/done`,
  assetFile: (id: string) => `/api/assets/${id}/file`,
  catalog: "/api/catalog",
  usage: "/api/usage",
} as const;
