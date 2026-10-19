import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/app";
import { readyProject } from "../shared/apiTestHelpers";
import type { AppDeps } from "../shared/deps";
import { makeTestDeps } from "../shared/testing";
import type { Project } from "../../shared/types";
import { SabiApi } from "./client";
import { TOOL_NAMES, callTool } from "./tools";

let deps: AppDeps, server: Server, api: SabiApi, project: Project, home: string;
beforeEach(async () => {
  deps = makeTestDeps();
  ({ project } = await readyProject(deps));
  server = createApp(deps).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  deps.apiBaseUrl = base;
  api = new SabiApi(base);
  home = mkdtempSync(join(homedir(), ".sabi-mcp-test-")); // file tools only accept paths under $HOME
});
afterEach(() => { server.close(); rmSync(home, { recursive: true, force: true }); });

const gateJob = () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  deps.jobs.enqueue(project.id, "plan", async ({ report }) => { report(30, "translate"); await gate; });
  return release;
};

describe("sabi mcp tools", () => {
  it("inspect pages phrases and searches words", async () => {
    const summary = await callTool(api, "inspect_project", { projectId: project.id });
    expect(summary.isError).toBeFalsy();
    expect(summary.text.length).toBeLessThanOrEqual(1500);
    expect(summary.text).toContain("status ready");
    expect(summary.text).toMatch(new RegExp(`baseVersion: ${project.updatedAt}$`));

    const page = await callTool(api, "inspect_project", { projectId: project.id, section: "phrases", limit: 2 });
    expect(page.text.split("\n").filter((l) => /^ph-\d+ \[/.test(l))).toHaveLength(2);
    expect(page.text).toContain("next offset 2");

    const hit = await callTool(api, "inspect_project", { projectId: project.id, search: "water" });
    const lines = hit.text.split("\n").filter((l) => l.startsWith('"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^"water" ph-\d+ w-\d+ \d:\d\d\.\d–\d:\d\d\.\d/);

    const list = await callTool(api, "list_projects", {});
    expect(list.text).toBe(`${project.id} · t · ready · 0:21 · en`);
  });

  it("a 10-minute transcript keeps the summary inside the token budget", async () => {
    const words = Array.from({ length: 1500 }, (_, i) => ({ id: `w-${i}`, text: i % 50 ? "word" : "water", startMs: i * 400, endMs: i * 400 + 300 }));
    const phrases = Array.from({ length: 300 }, (_, i) => ({ id: `ph-${i}`, startMs: i * 2000, endMs: i * 2000 + 1900, words: words.slice(i * 5, i * 5 + 5), lineBreaksAfter: [] }));
    const cuts = Array.from({ length: 200 }, (_, i) => ({ id: `cut-${i}`, startMs: i * 3000 + 1950, endMs: i * 3000 + 1990, reason: "pause" as const, text: "", shouldTrim: true }));
    const shots = Array.from({ length: 100 }, (_, i) => ({ id: `shot-${i}`, kind: "Talking Head" as const, startMs: i * 6000, endMs: i * 6000 + 6000 }));
    await deps.projects.update(project.id, { phrases, editPlan: { cuts, shots }, sourceDurationMs: 600_000 });
    const summary = await callTool(api, "inspect_project", { projectId: project.id });
    expect(summary.text.length).toBeLessThan(6000); // ≈ 1 500 tokens
    expect(summary.text).toContain("… 70 more (section: \"plan\")");
    const page = await callTool(api, "inspect_project", { projectId: project.id, section: "phrases", offset: 280 });
    expect(page.text).toContain("ph-299 [9:58.0–9:59.9 → out ");
    expect(page.text).not.toContain("next offset");
    const hits = await callTool(api, "inspect_project", { projectId: project.id, search: "^water$", limit: 5 });
    expect(hits.text.split("\n")[0]).toBe("30 match(es) for /^water$/i");
    expect(hits.text).toContain("next offset 5 (of 30)");
  });

  it("render_frame returns png content", async () => {
    const res = await callTool(api, "render_frame", { projectId: project.id, timestampMs: 1000 });
    expect(res.isError).toBeFalsy();
    expect(res.image!.mimeType).toBe("image/png");
    expect(res.image!.data.subarray(1, 4).toString()).toBe("PNG");
    expect(res.text).toBe("frame at 0:01.0 (output timeline)");
  });

  it("apply_actions reports stale and busy as errors", async () => {
    const ok = await callTool(api, "apply_actions", { projectId: project.id, baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "New" }] });
    expect(ok.isError).toBeFalsy();
    expect(ok.text).toMatch(/^applied 1 action\(s\); baseVersion now \S+$/);
    const now = ok.text.split(" ").at(-1)!;

    const stale = await callTool(api, "apply_actions", { projectId: project.id, baseVersion: project.updatedAt, actions: [{ type: "setTitle", title: "Old" }] });
    expect(stale).toMatchObject({ isError: true, text: `project changed since baseVersion ${project.updatedAt} (now ${now}); re-run inspect_project` });

    const release = gateJob();
    const busy = await callTool(api, "apply_actions", { projectId: project.id, baseVersion: now, actions: [{ type: "setTitle", title: "x" }] });
    expect(busy.isError).toBe(true);
    expect(busy.text).toContain("busy: plan job");
    expect(busy.text).toContain("30% (translate)");
    const frame = await callTool(api, "render_frame", { projectId: project.id, timestampMs: 0 });
    expect(frame.isError).toBe(true);
    release();
  });

  it("run_job + wait_job reach ready", async () => {
    const started = await callTool(api, "run_job", { projectId: project.id, kind: "render" });
    expect(started.text).toMatch(/^job \S+ \(render\) started/);
    const waited = await callTool(api, "wait_job", { projectId: project.id });
    expect(waited.isError).toBeFalsy();
    expect(waited.text).toMatch(/^status ready after \d+s/);
  });

  it("creates a project from a local file and exports its outputs", async () => {
    const clip = join(home, "clip.mp4");
    writeFileSync(clip, "fake-video");
    const created = await callTool(api, "create_project", { title: "Clip", path: clip });
    expect(created.isError).toBeFalsy();
    const id = created.text.match(/^project (\S+) created; next: run_job captions$/)![1];
    expect((await api.getProject(id)).sourceAssetId).toBeTruthy();

    const out = await callTool(api, "export_outputs", { projectId: project.id, outDir: home });
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain(join(home, "t.mp4"));
    expect(readFileSync(join(home, "t.mp4"), "utf8")).toBe("fake-mp4");
    expect(readFileSync(join(home, "t.srt"), "utf8")).toContain("-->");
  });

  it("file tools refuse bad paths", async () => {
    const before = (await api.listProjects()).length;
    const outside = await callTool(api, "create_project", { title: "x", path: "/etc/hosts" });
    expect(outside).toMatchObject({ isError: true });
    expect(outside.text).toContain("outside your home directory");
    const gif = join(home, "a.gif");
    writeFileSync(gif, "GIF89a");
    expect((await callTool(api, "create_project", { title: "x", path: gif })).text).toContain("unsupported file type");
    expect((await callTool(api, "create_project", { title: "x", path: join(home, "missing.mp4") })).text).toContain("no such file");
    expect((await api.listProjects()).length).toBe(before);
    expect((await callTool(api, "export_outputs", { projectId: project.id, outDir: "/nope" })).isError).toBe(true);
    expect((await callTool(api, "export_outputs", { projectId: project.id, outDir: "/tmp" })).text).toContain("outside your home directory");
    expect((await callTool(api, "export_outputs", { projectId: project.id, outDir: join(home, "nope") })).text).toContain("no such directory");
  });

  it("tools report an unreachable api", async () => {
    const down = new SabiApi("http://127.0.0.1:1");
    const clip = join(home, "clip.mp4");
    writeFileSync(clip, "x");
    const inputs: Record<(typeof TOOL_NAMES)[number], object> = {
      list_projects: {}, inspect_project: { projectId: "p" }, render_frame: { projectId: "p", timestampMs: 0 },
      apply_actions: { projectId: "p", baseVersion: "v", actions: [{ type: "setTitle", title: "x" }] },
      run_job: { projectId: "p", kind: "render" }, wait_job: { projectId: "p" },
      create_project: { title: "x", path: clip }, export_outputs: { projectId: "p", outDir: home },
    };
    const t0 = Date.now();
    for (const name of TOOL_NAMES) {
      const res = await callTool(down, name, inputs[name]);
      expect(res, name).toMatchObject({ isError: true });
      expect(res.text, name).toBe("Sabi API not reachable at http://127.0.0.1:1 — start it with `npm run dev:lite` (or the \"api-lite-fake\" launch config)");
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
