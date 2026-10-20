import type { AssetRepository } from "../modules/assets/repository";
import type { ProjectRepository } from "../modules/projects/repository";
import type { EventBus } from "./events";
import type { MediaGenerator } from "./generator";
import type { JobRunner } from "./jobs";
import type { Llm } from "./llm";
import type { Media } from "./media";
import type { Renderer } from "./renderer";
import type { StockSearch } from "./stock";
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
  renderer: Renderer;
  llm: Llm;
  fetch: typeof fetch; // remote B-roll media (importRemote); injected so tests never reach the network
  stock: StockSearch | null; // null when PEXELS_KEY is unset
  generator: MediaGenerator | null; // null when FAL_KEY is unset
  apiBaseUrl: string; // where Chromium (Remotion) fetches source media during renders
  now: () => Date;
  id: () => string;
}
