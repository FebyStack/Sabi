import { MemoryJobRunner } from "./jobs";
import { runnerContract } from "./jobRunnerContract";

describe("MemoryJobRunner", () => {
  runnerContract(async (bus) => new MemoryJobRunner(bus));
});
