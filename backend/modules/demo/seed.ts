import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AssetSchema, ProjectSchema } from "../../../shared/contract";
import type { Project } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";

const Manifest = z.object({ project: ProjectSchema, assets: z.array(AssetSchema) });

// First run (spec rows 5, 17): with no projects at all, the committed demo bundle becomes an ordinary, editable project.
export async function seedDemo(deps: AppDeps, dir = resolve("database/seed/demo")): Promise<Project | null> {
  if ((await deps.projects.list()).length) return null;
  const { project, assets } = Manifest.parse(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")));
  const now = deps.now().toISOString();
  for (const a of assets) {
    await deps.storage.write(`demo/${a.key}`, createReadStream(join(dir, a.key)));
    await deps.assets.create({ ...a, key: `demo/${a.key}`, createdAt: now });
  }
  return deps.projects.create({ ...project, demo: true, createdAt: now, updatedAt: now });
}
