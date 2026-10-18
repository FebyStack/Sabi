import request from "supertest";
import { createApp } from "./app";
import { makeTestDeps } from "../shared/testing";

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
});
