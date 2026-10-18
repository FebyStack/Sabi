import { MemoryProjectRepository } from "./repository";
import type { Project } from "../../../shared/types";

const base: Project = {
  id: "p1", title: "t", aspectRatio: "9:16", mediaSource: "generate", status: "transcribing", sourceAssetId: "a", sourceKind: "video", language: null,
  captionTemplateId: "clean", transcript: null, phrases: [], outputs: {}, warnings: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ProjectRepository.failStuck", () => {
  it("marks projects left in a running status as failed on boot", async () => {
    const repo = new MemoryProjectRepository();
    await repo.create(base);
    await repo.create({ ...base, id: "p2", status: "rendering" });
    await repo.create({ ...base, id: "p3", status: "ready" });
    expect(await repo.failStuck()).toBe(2);
    expect((await repo.get("p1"))?.status).toBe("failed");
    expect((await repo.get("p3"))?.status).toBe("ready");
  });
});
