import type { AssetRepository } from "../modules/assets/repository";
import type { ProjectRepository } from "../modules/projects/repository";
import type { Media } from "./media";
import type { Storage } from "./storage";

// Everything the app needs is injected here so the whole API can run with fakes (tests, dev:lite).
export interface AppDeps {
  projects: ProjectRepository;
  assets: AssetRepository;
  storage: Storage;
  media: Media;
  now: () => Date;
  id: () => string;
}
