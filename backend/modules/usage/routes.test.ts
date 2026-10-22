import request from "supertest";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import type { LedgerEntry } from "./ledger";

const row = (id: string, projectId: string, costCents: number, createdAt: string): LedgerEntry =>
  ({ id, projectId, provider: "fal", model: costCents === 25 ? "fal-ai/kling-video/v1.6/standard/image-to-video" : "fal-ai/flux/schnell", media: costCents === 25 ? "video" : "image", costCents, jobKind: "broll", actor: "web", createdAt });

describe("usage api", () => {
  it("catalog lists the four models with availability and spend", async () => {
    const deps = makeTestDeps({ spendCapCents: 2000 });
    await deps.ledger.record(row("r1", "p1", 25, "2026-01-01T00:00:00.000Z"));
    const res = await request(createApp(deps)).get("/api/catalog");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      models: [
        { id: "fal-ai/flux/schnell", provider: "fal", media: "image", costCents: 1, available: true },
        { id: "fal-ai/kling-video/v1.6/standard/image-to-video", provider: "fal", media: "video", costCents: 25, available: true },
        { id: "pexels-photo", provider: "pexels", media: "image", costCents: 0, available: true },
        { id: "pexels-video", provider: "pexels", media: "video", costCents: 0, available: true },
      ],
      spend: { monthCents: 25, capCents: 2000 },
    });
    const none = await request(createApp(makeTestDeps({ generator: null, stock: null }))).get("/api/catalog");
    expect(none.body.models.map((m: { available: boolean }) => m.available)).toEqual([false, false, false, false]);
  });

  it("usage reports months, the cap and deleted projects", async () => {
    const deps = makeTestDeps({ spendCapCents: 500 });
    const a = createApp(deps);
    const { body: project } = await request(a).post("/api/projects").send({ title: "Morning" });
    await deps.ledger.record(row("r1", project.id, 1, "2026-01-01T00:00:00.000Z"));
    await deps.ledger.record(row("r2", "deleted-one", 25, "2025-12-20T00:00:00.000Z"));
    const res = await request(a).get("/api/usage");
    expect(res.status).toBe(200);
    expect(res.body.capCents).toBe(500);
    expect(res.body.monthCents).toBe(1);
    expect(res.body.months.map((m: { month: string; totalCents: number }) => [m.month, m.totalCents])).toEqual([["2026-01", 1], ["2025-12", 25]]);
    expect(res.body.months[0].rows[0]).toMatchObject({ projectId: project.id, projectTitle: "Morning" });
    expect(res.body.months[1].rows[0]).toMatchObject({ projectId: "deleted-one", projectTitle: null });
    expect((await request(a).get("/api/usage")).body.months).toHaveLength(2); // reading usage changes nothing
  });
});
