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

export const api = {
  health: "/api/health",
  projects: "/api/projects",
  project: (id: string) => `/api/projects/${id}`,
} as const;
