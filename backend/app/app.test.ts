import request from "supertest";
import { createApp, parseAllowedOrigins } from "./app";
import { makeTestDeps } from "../shared/testing";
import { PlanInput } from "../../shared/contract";

const app = () => createApp(makeTestDeps());

describe("api", () => {
  it("health", async () => {
    const res = await request(app()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, time: "2026-01-01T00:00:00.000Z" });
  });

  it("creates, lists and gets a project", async () => {
    const a = app();
    const created = await request(a).post("/api/projects").send({ title: "Morning routine" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: "id-1", title: "Morning routine", aspectRatio: "9:16", mediaSource: "generate", status: "draft" });

    const list = await request(a).get("/api/projects");
    expect(list.body).toHaveLength(1);

    const one = await request(a).get("/api/projects/id-1");
    expect(one.body.id).toBe("id-1");
    expect((await request(a).get("/api/projects/nope")).status).toBe(404);
  });

  it("rejects invalid input", async () => {
    const res = await request(app()).post("/api/projects").send({ title: "", mediaSource: "magic" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  it("new projects start with no plan, translations or burn-in", async () => {
    const { body } = await request(app()).post("/api/projects").send({ title: "t" });
    expect(body).toMatchObject({ sourceDurationMs: null, editPlan: null, translations: [], burnInLanguage: null });
  });

  it("creates a project with empty overlays and zero credits", async () => {
    const { body } = await request(app()).post("/api/projects").send({ title: "t" });
    expect(body.overlays).toEqual([]);
    expect(body.creditsUsedCents).toBe(0);
  });

  it("creates a project with no brand and no motion graphics", async () => {
    const { body } = await request(app()).post("/api/projects").send({ title: "t" });
    expect(body.brand).toBeNull();
    expect(body.motionGraphics).toEqual([]);
  });

  it("creates a project with no caption style and not demo", async () => {
    const { body } = await request(app()).post("/api/projects").send({ title: "t" });
    expect(body).toMatchObject({ captionStyle: null, demo: false });
  });

  it("patches mediaSource", async () => {
    const a = app();
    const { body: p } = await request(a).post("/api/projects").send({ title: "t" });
    const res = await request(a).patch(`/api/projects/${p.id}`).send({ mediaSource: "stock" });
    expect(res.status).toBe(200);
    expect(res.body.mediaSource).toBe("stock");
    expect((await request(a).get(`/api/projects/${p.id}`)).body.mediaSource).toBe("stock");
    const bad = await request(a).patch(`/api/projects/${p.id}`).send({ mediaSource: "magic" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_input");
    expect((await request(a).patch("/api/projects/nope").send({ mediaSource: "stock" })).status).toBe(404);
  });

  it("refuses writes from another site and only lets local pages read", async () => {
    const a = app();
    const evil = await request(a).post("/api/projects").set("origin", "https://evil.example").send({ title: "x" });
    expect(evil.status).toBe(403);
    expect(evil.body).toEqual({ error: "cross_origin" });
    expect((await request(a).post("/api/projects").set("origin", "null").send({ title: "x" })).status).toBe(403);
    expect((await request(a).post("/api/projects").set("origin", "http://localhost:5173").send({ title: "x" })).status).toBe(201);
    expect((await request(a).post("/api/projects").send({ title: "x" })).status).toBe(201); // MCP, curl: no Origin
    const read = await request(a).get("/api/projects").set("origin", "https://evil.example");
    expect(read.headers["access-control-allow-origin"]).toBeUndefined();
    const local = await request(a).get("/api/projects").set("origin", "http://127.0.0.1:3000");
    expect(local.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
  });

  it("refuses requests addressed to a foreign host (DNS rebinding)", async () => {
    const a = createApp(makeTestDeps({ apiBaseUrl: "http://api:3001" }));
    const evil = await request(a).get("/api/projects").set("host", "evil.example:3001");
    expect(evil.status).toBe(403);
    expect(evil.body).toEqual({ error: "bad_host" });
    for (const host of ["localhost:3001", "127.0.0.1:3001", "[::1]:3001", "localhost", "api:3001"]) {
      expect((await request(a).get("/api/projects").set("host", host)).status, host).toBe(200);
    }
  });

  it("allowedOrigins opens the API to a LAN dev origin (phone testing) and nothing else", async () => {
    const a = createApp(makeTestDeps({ allowedOrigins: ["http://192.168.1.5:5173"] }));
    const lan = { origin: "http://192.168.1.5:5173", host: "192.168.1.5:5173" };
    expect((await request(a).post("/api/projects").set(lan).send({ title: "x" })).status).toBe(201);
    expect((await request(a).get("/api/projects").set(lan)).headers["access-control-allow-origin"]).toBe("http://192.168.1.5:5173");
    expect((await request(a).post("/api/projects").set({ origin: "http://192.168.1.6:5173", host: "192.168.1.5:5173" }).send({ title: "x" })).status).toBe(403);
    expect((await request(a).get("/api/projects").set("host", "192.168.1.6:5173")).status).toBe(403);
  });

  it("allowedOrigins comes from ALLOWED_ORIGINS", () => {
    expect(parseAllowedOrigins(" http://192.168.1.5:5173 ,https://sabi.local/ ,")).toEqual(["http://192.168.1.5:5173", "https://sabi.local"]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it("PlanInput rejects burn-in of an untranslated language", () => {
    expect(PlanInput.safeParse({ languages: ["es"], burnInLanguage: "fr" }).success).toBe(false);
    expect(PlanInput.safeParse({ languages: ["es", "fr", "de", "ja"] }).success).toBe(false);
    expect(PlanInput.parse({})).toEqual({ languages: [], burnInLanguage: null });
  });
});
