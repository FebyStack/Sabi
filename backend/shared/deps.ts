import type { AssetRepository } from "../modules/assets/repository";
import type { ProjectRepository } from "../modules/projects/repository";
import type { EventBus } from "./events";
import type { JobRunner } from "./jobs";
import type { Media } from "./media";
import type { Storage } from "./storage";
import type { Transcriber } from "./transcriber";

// Everything the app needs is injected here so the whole API can run with fakes (tests, dev:lite).
export interface AppDeps {
  projects: ProjectRepository;
  assets: AssetRepository;
  storage: Storage;
  media: Media;
  bus: EventBus;
  jobs: JobRunner;
  transcriber: Transcriber;
  now: () => Date;
  id: () => string;
}
