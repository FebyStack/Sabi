import type { AppDeps } from "../../shared/deps";
import { removeProject } from "../projects/remove";

// The banner's promise (spec rows 2, 18): projects not opened since `olderThan` go, files included; a running job is never touched.
export async function sweepRetention(deps: AppDeps, olderThan: Date): Promise<string[]> {
  const ids = (await deps.projects.staleIds(olderThan)).filter((id) => !deps.jobs.active(id));
  for (const id of ids) await removeProject(deps, id);
  return ids;
}

// On boot and hourly; RETENTION_DAYS=0 disables it.
export function startRetention(deps: AppDeps, days = Number(process.env.RETENTION_DAYS ?? 30)): void {
  if (!(days > 0)) return;
  const run = () => sweepRetention(deps, new Date(deps.now().getTime() - days * 86_400_000))
    .then((removed) => console.error(`retention: removed ${removed.length}`))
    .catch((err) => console.error("retention: failed", err));
  void run();
  setInterval(run, 3_600_000).unref();
}
