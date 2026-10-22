import type { AppDeps } from "../../shared/deps";

// A project and everything stored for it: asset files and rows, the transcription work file, its finished jobs, then the row.
// Shared by DELETE /api/projects/:id and the retention sweep; callers check that no job is running.
export async function removeProject(deps: AppDeps, id: string): Promise<void> {
  for (const a of await deps.assets.listByProject(id)) await deps.storage.remove(a.key);
  await deps.storage.remove(`work/${id}/audio.wav`);
  await deps.assets.removeByProject(id);
  await deps.jobs.forget(id);
  await deps.projects.remove(id);
}
