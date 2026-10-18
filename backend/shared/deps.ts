import type { ProjectRepository } from "../modules/projects/repository";

// Everything the app needs is injected here so the whole API can run with fakes (tests, dev:lite).
export interface AppDeps {
  projects: ProjectRepository;
  now: () => Date;
  id: () => string;
}
