// Single wire contract shared by frontend and backend. Never mirror per tier.
import { z } from "zod";

export const AspectRatio = z.enum(["9:16", "16:9"]);
export const MediaSource = z.enum(["generate", "stock"]); // per-project: fal.ai generation or Pexels stock only
export const ProjectStatus = z.enum(["draft", "transcribing", "planning", "generating", "rendering", "ready", "failed"]);

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  aspectRatio: AspectRatio,
  mediaSource: MediaSource,
  status: ProjectStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});

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
  uploadsStart: "/api/assets/uploads/start",
  upload: (uploadId: string) => `/api/assets/uploads/${uploadId}`,
  uploadDone: (uploadId: string) => `/api/assets/uploads/${uploadId}/done`,
  assetFile: (id: string) => `/api/assets/${id}/file`,
} as const;
