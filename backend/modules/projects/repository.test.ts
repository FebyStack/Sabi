import { MemoryProjectRepository } from "./repository";
import type { Project } from "../../../shared/types";

const base: Project = {
  id: "p1", title: "t", aspectRatio: "9:16", mediaSource: "generate", status: "transcribing", sourceAssetId: "a", sourceKind: "video", language: null,
  captionTemplateId: "clean", transcript: null, phrases: [], outputs: {}, warnings: [], sourceDurationMs: null, editPlan: null, translations: [], burnInLanguage: null, overlays: [], creditsUsedCents: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
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

describe("MemoryProjectRepository.update", () => {
  it("update replaces overlays", async () => {
    const repo = new MemoryProjectRepository();
    await repo.create(base);
    const overlay = {
      id: "ov-0", shotId: "shot-1", assetId: "a2", media: "image" as const, source: "stock" as const, startMs: 4300, endMs: 9300, placement: "full" as const,
      transition: "fade" as const, enabled: true, query: "q", prompt: "p", intent: "i", attribution: { author: "Ann", url: "https://www.pexels.com/photo/1" },
    };
    await repo.update("p1", { overlays: [overlay], creditsUsedCents: 3 });
    expect(await repo.get("p1")).toMatchObject({ overlays: [overlay], creditsUsedCents: 3 });
    await repo.update("p1", { overlays: [] });
    expect((await repo.get("p1"))?.overlays).toEqual([]);
  });
});
