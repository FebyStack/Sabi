import { HealthSchema, ProjectSchema, api } from "@shared/contract";
import type { CreateProjectInput, Project } from "@shared/types";

export async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${input} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const getHealth = () => json(api.health).then(HealthSchema.parse);
export const listProjects = () => json<unknown[]>(api.projects).then((r) => r.map((p) => ProjectSchema.parse(p)));
export const createProject = (input: CreateProjectInput) =>
  json<Project>(api.projects, { method: "POST", body: JSON.stringify(input) }).then(ProjectSchema.parse);
