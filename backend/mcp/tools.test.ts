import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/app";
import { readyProject } from "../shared/apiTestHelpers";
import type { AppDeps } from "../shared/deps";
import { FakeLlm } from "../shared/llm";
import { FakeRenderer } from "../shared/renderer";
import { makeTestDeps } from "../shared/testing";
import type { Project } from "../../shared/types";
import { SabiApi } from "./client";
import { TOOL_NAMES, callTool, syncedToICloud, toolSpec } from "./tools";

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

  it("wait_job reports a failed plan job with its error", async () => {
    deps.llm = new FakeLlm(() => { throw new Error("llm_unavailable"); });
    expect((await callTool(api, "run_job", { projectId: project.id, kind: "plan", languages: ["es"] })).isError).toBeFalsy();
    const waited = await callTool(api, "wait_job", { projectId: project.id });
    expect(waited.isError).toBe(true);
    expect(waited.text).toMatch(/^status ready after \d+s; last job plan FAILED: llm_unavailable/);
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

  it("export never overwrites or follows existing files", async () => {
    const victim = join(home, "victim.txt");
    writeFileSync(victim, "keep me");
    symlinkSync(victim, join(home, "t.mp4"));
    writeFileSync(join(home, "t (2).srt"), "mine");
    const out = await callTool(api, "export_outputs", { projectId: project.id, outDir: home });
    expect(out.isError).toBeFalsy();
    expect(readFileSync(victim, "utf8")).toBe("keep me");
    expect(readFileSync(join(home, "t (2).srt"), "utf8")).toBe("mine");
    expect(out.text).toContain(join(home, "t (3).mp4"));
    expect(readFileSync(join(home, "t (3).mp4"), "utf8")).toBe("fake-mp4");
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

  it("a folder iCloud syncs is found by its synced ancestor below $HOME", async () => {
    // macOS marks the roots it syncs (~/Desktop, ~/Documents, ~/Library/Mobile Documents), not their subfolders.
    const domains: Record<string, string> = { [join(home, "Desktop")]: "com.apple.CloudDocs.iCloudDriveFileProvider/X", [join(home, "Drop")]: "com.getdropbox.dropbox/Y" };
    const domainOf = async (dir: string) => domains[dir] ?? "";
    expect(await syncedToICloud(join(home, "Desktop", "renders", "a"), home, domainOf)).toBe(true);
    expect(await syncedToICloud(join(home, "Desktop"), home, domainOf)).toBe(true);
    expect(await syncedToICloud(join(home, "Movies", "Sabi"), home, domainOf)).toBe(false);
    expect(await syncedToICloud(join(home, "Drop"), home, domainOf)).toBe(false);
    expect(await syncedToICloud(home, home, domainOf)).toBe(false);
  });

  // iCloud Drive's own root is read-only, so even a broken check writes nothing there.
  const iCloudDrive = join(homedir(), "Library", "Mobile Documents");
  const iCloudOn = (() => { try { return execFileSync("xattr", ["-p", "com.apple.file-provider-domain-id", iCloudDrive], { stdio: "pipe" }).toString().startsWith("com.apple.CloudDocs"); } catch { return false; } })();
  it.runIf(iCloudOn)("export refuses a folder iCloud syncs (it can evict the files off this Mac)", async () => {
    const out = await callTool(api, "export_outputs", { projectId: project.id, outDir: iCloudDrive });
    expect(out).toMatchObject({ isError: true });
    expect(out.text).toContain("syncs to iCloud");
    expect(out.text).toContain("~/Movies/Sabi");
    expect((await callTool(api, "export_outputs", { projectId: project.id, outDir: home })).isError).toBeFalsy();
  });

  it("tools report an unreachable api", async () => {
    const down = new SabiApi("http://127.0.0.1:1");
    const clip = join(home, "clip.mp4");
    writeFileSync(clip, "x");
    const inputs: Record<(typeof TOOL_NAMES)[number], object> = {
      list_projects: {}, inspect_project: { projectId: "p" }, render_frame: { projectId: "p", timestampMs: 0 },
      apply_actions: { projectId: "p", baseVersion: "v", actions: [{ type: "setTitle", title: "x" }] },
      run_job: { projectId: "p", kind: "render" }, wait_job: { projectId: "p" },
      create_project: { title: "x", path: clip }, export_outputs: { projectId: "p", outDir: home }, upload_asset: { projectId: "p", path: clip },
    };
    const t0 = Date.now();
    for (const name of TOOL_NAMES) {
      const res = await callTool(down, name, inputs[name]);
      expect(res, name).toMatchObject({ isError: true });
      expect(res.text, name).toBe("Sabi API not reachable at http://127.0.0.1:1 — start it with `npm run dev:lite` (or the \"api-lite-fake\" launch config)");
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  const planned = async () => {
    await callTool(api, "run_job", { projectId: project.id, kind: "plan" });
    expect((await callTool(api, "wait_job", { projectId: project.id })).isError).toBeFalsy();
    return deps.projects.get(project.id) as Promise<Project>;
  };
  const MG = { type: "addMotionGraphic", name: "Stat", code: "const Component = ({ item }) => <div style={{ color: item.brand.accent }}>{item.props.title}</div>;",
    startMs: 1000, endMs: 3000, props: [{ key: "title", type: "text", value: "42%" }] };

  it("inspect broll section lists beats, overlays, motion graphics and brand", async () => {
    const p = await planned();
    const shot = p.editPlan!.shots.find((s) => s.kind === "B-Roll")!;
    const seeded = await deps.projects.update(p.id, { overlays: [{
      id: "ov-0", shotId: shot.id, assetId: "a1", media: "image", source: "stock", startMs: shot.startMs + 300, endMs: shot.startMs + 2300,
      placement: "full", transition: "fade", enabled: true, query: "glass of water", prompt: "p", intent: "i", attribution: { author: "Jane Doe", url: "https://www.pexels.com/photo/1" },
    }] });
    const applied = await callTool(api, "apply_actions", { projectId: p.id, baseVersion: seeded.updatedAt, actions: [{ ...MG, box: { x: 0, y: 0.6, w: 1, h: 0.3 } }] });
    expect(applied.isError).toBeFalsy();
    const res = await callTool(api, "inspect_project", { projectId: p.id, section: "broll" });
    expect(res.text).toContain(`beat-0 ${shot.id} full`);
    expect(res.text).toMatch(/ov-0 shot-\d image stock full \d:\d\d\.\d–\d:\d\d\.\d on "glass of water" \(Photo: Jane Doe \/ Pexels\)/);
    expect(res.text).toMatch(/mg-0 "Stat" 0:01\.0–0:03\.0 box 0,0\.6 1×0\.3 on props: title ⚠ overlaps captions/);
    expect(res.text).toContain("brand: none (template colours)");
    const summary = await callTool(api, "inspect_project", { projectId: p.id });
    expect(summary.text).toContain("overlays 1 (1 on) · motion graphics 1 · brand none");
    expect(summary.text).toContain("media source generate");
  });

  it("run_job broll reaches ready with overlays", async () => {
    await planned();
    const started = await callTool(api, "run_job", { projectId: project.id, kind: "broll" });
    expect(started.text).toMatch(/job .+ \(broll\) started; next: wait_job/);
    expect((await callTool(api, "wait_job", { projectId: project.id })).isError).toBeFalsy();
    const summary = await callTool(api, "inspect_project", { projectId: project.id });
    expect(summary.text).toContain("overlays 1 (1 on)");
  });

  it("upload_asset returns an image asset id and refuses other types", async () => {
    const png = join(home, "logo.png");
    writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const ok = await callTool(api, "upload_asset", { projectId: project.id, path: png });
    expect(ok.isError).toBeFalsy();
    expect(ok.text).toMatch(/^asset id-\d+ \(image 1080×1920\); use it in replaceOverlay, setBrand\.logoAssetId or an image prop$/);
    const gif = join(home, "x.gif");
    writeFileSync(gif, "GIF89a");
    const bad = await callTool(api, "upload_asset", { projectId: project.id, path: gif });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("unsupported file type .gif");
  });

  it("apply_actions sets a brand and a motion graphic and render_frame still answers", async () => {
    const brand = { palette: { primary: "#1E90FF", accent: "#FFD60A", text: "#FFFFFF", background: "#0B0B0B" }, fontFamily: "Inter" };
    const res = await callTool(api, "apply_actions", { projectId: project.id, baseVersion: project.updatedAt, actions: [{ type: "setBrand", brand }, MG] });
    expect(res.isError).toBeFalsy();
    const frame = await callTool(api, "render_frame", { projectId: project.id, timestampMs: 1500 });
    expect(frame.image!.mimeType).toBe("image/png");
    const summary = await callTool(api, "inspect_project", { projectId: project.id });
    expect(summary.text).toContain("brand #1E90FF Inter grade 0.4");
  });

  it("summary flags stale outputs", async () => {
    const edit = await callTool(api, "apply_actions", { projectId: project.id, baseVersion: project.updatedAt, actions: [{ type: "editPhrase", phraseId: project.phrases[0].id, text: "New words" }] });
    expect(edit.text).toMatch(/; outputs now stale — run_job render before export_outputs$/);
    expect((await callTool(api, "inspect_project", { projectId: project.id })).text).toMatch(/^outputs: mp4 \S+ · srt · vtt \(stale\)$/m);
    const refused = await callTool(api, "export_outputs", { projectId: project.id, outDir: home });
    expect(refused).toMatchObject({ isError: true, text: "outputs are stale; run_job render first" });
    await callTool(api, "run_job", { projectId: project.id, kind: "render" });
    expect((await callTool(api, "wait_job", { projectId: project.id })).isError).toBeFalsy();
    expect((await callTool(api, "inspect_project", { projectId: project.id })).text).not.toContain("(stale)");
    expect((await callTool(api, "export_outputs", { projectId: project.id, outDir: home })).isError).toBeFalsy();
    const title = await callTool(api, "apply_actions", { projectId: project.id, baseVersion: (await api.getProject(project.id)).updatedAt, actions: [{ type: "setTitle", title: "x" }] });
    expect(title.text).not.toContain("stale");
  });

  it("run_job render takes a scale", async () => {
    await callTool(api, "run_job", { projectId: project.id, kind: "render", scale: 2 });
    await callTool(api, "wait_job", { projectId: project.id });
    expect((deps.renderer as FakeRenderer).calls.at(-1)!.scale).toBe(2);
    expect((await api.getProject(project.id)).outputs.resolution).toBe("4k");
  });

  it("summary shows the caption style", async () => {
    const set = await callTool(api, "apply_actions", { projectId: project.id, baseVersion: project.updatedAt, actions: [{ type: "setCaptionStyle", style: { sizePx: 72, fontFamily: "Bebas Neue" } }] });
    expect(set.isError, set.text).toBeFalsy();
    expect((await callTool(api, "inspect_project", { projectId: project.id })).text).toContain('caption style {"fontFamily":"Bebas Neue","sizePx":72}');
  });

  it("apply_actions lists every action type", () => {
    for (const t of ["setMediaSource", "setShotBounds", "retimePhraseRange", "setWordEmphasis", "setPhraseEmoji", "setCaptionStyle", "setOverlay", "removeOverlay", "replaceOverlay", "setBrand", "addMotionGraphic", "updateMotionGraphic", "removeMotionGraphic"]) {
      expect(toolSpec("apply_actions").description).toContain(t);
    }
  });
});
