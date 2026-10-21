import { MemoryProjectRepository, StaleVersion } from "./repository";
import type { Project } from "../../../shared/types";

const base: Project = {
  id: "p1", title: "t", aspectRatio: "9:16", mediaSource: "generate", status: "transcribing", sourceAssetId: "a", sourceKind: "video", language: null,
  captionTemplateId: "clean", transcript: null, phrases: [], outputs: {}, warnings: [], sourceDurationMs: null, editPlan: null, translations: [], burnInLanguage: null, overlays: [], creditsUsedCents: 0, brand: null, motionGraphics: [], captionStyle: null, demo: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
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

describe("ProjectRepository retention", () => {
  it("staleIds lists projects by last access", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const repo = new MemoryProjectRepository(() => now);
    await repo.create(base);
    await repo.create({ ...base, id: "p2" });
    now = new Date("2026-02-01T00:00:00.000Z");
    await repo.get("p2"); // opening a project refreshes it
    expect(await repo.staleIds(new Date("2026-01-15T00:00:00.000Z"))).toEqual(["p1"]);
    await repo.remove("p1");
    expect(await repo.get("p1")).toBeNull();
    expect(await repo.staleIds(new Date("2026-03-01T00:00:00.000Z"))).toEqual(["p2"]);
  });
});

describe("ProjectRepository.update ifVersion", () => {
  it("writes only when the stored version still matches", async () => {
    const repo = new MemoryProjectRepository();
    await repo.create(base);
    const ok = await repo.update("p1", { title: "a" }, { ifVersion: base.updatedAt });
    expect(ok.title).toBe("a");
    const err = await repo.update("p1", { title: "b" }, { ifVersion: base.updatedAt }).catch((e) => e);
    expect(err).toBeInstanceOf(StaleVersion);
    expect(err.currentVersion).toBe(ok.updatedAt);
    expect((await repo.get("p1"))?.title).toBe("a");
  });
});

describe("MemoryProjectRepository brand and motion graphics", () => {
  it("update round-trips brand and motion graphics", async () => {
    const repo = new MemoryProjectRepository();
    await repo.create(base);
    const brand = { palette: { primary: "#1E90FF", accent: "#FFD60A", text: "#FFFFFF", background: "#0B0B0B" }, fontFamily: "Inter" as const, logoAssetId: null, grade: 0.4 };
    const mg = {
      id: "mg-0", name: "Stat", code: "const Component = () => null;", compiled: "x", startMs: 1000, endMs: 3000,
      box: { x: 0, y: 0, w: 1, h: 0.5 }, props: [{ key: "title", type: "text" as const, value: "42%" }], enabled: true,
    };
    await repo.update("p1", { brand, motionGraphics: [mg] });
    expect(await repo.get("p1")).toMatchObject({ brand, motionGraphics: [mg] });
  });
});
