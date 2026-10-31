import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { SabiApi, SabiHttpError } from "../../backend/mcp/client";
import { keptSegments } from "../../shared/editing/cuts";
import { enabledCuts } from "../../shared/editing/renderProps";
import type { JobState, Project } from "../../shared/types";

// The first real run, through the agent's own client (npm run pipeline:sample, spec row 28). Needs the API running
// (npm run dev:lite with real providers), whisperX and Ollama; Pexels only when the API has PEXELS_KEY. Never calls fal or generate.
const api = new SabiApi(process.env.SABI_API_URL ?? "http://127.0.0.1:3001");
const CLIP = process.env.SAMPLE_CLIP ?? join(homedir(), "Developer/Reverse Engineer/test-clip-9x16.mp4");
const SLOW = 1_800_000; // a cold sidecar downloads its model on the first clip
const timings: [string, number][] = [];

// Polls one job until it finishes; records seconds per stage.
async function waitJob(projectId: string, jobId: string, label: string): Promise<JobState> {
  let last: string | undefined, at = Date.now();
  for (;;) {
    const job = await api.getJobById(projectId, jobId);
    const stage = job.stage ?? job.state.toLowerCase();
    if (stage !== last) { if (last) timings.push([`${label}/${last}`, (Date.now() - at) / 1000]); last = stage; at = Date.now(); }
    if (job.state === "COMPLETE" || job.state === "FAILED") { timings.push([`${label}/${last}`, (Date.now() - at) / 1000]); return job; }
    await new Promise((r) => setTimeout(r, 500));
  }
}
const probe = (file: string, entries: string) =>
  execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "default=nw=1:nk=1", file]).toString().trim().split("\n").map(Number);

describe.skipIf(process.env.RUN_PIPELINE !== "1")("pipeline on a real clip", () => {
  let project: Project | undefined;
  afterAll(() => {
    console.log(["stage | seconds", ...timings.map(([s, t]) => `${s} | ${t.toFixed(1)}`), `total | ${timings.reduce((n, [, t]) => n + t, 0).toFixed(1)}`, "spent 0¢"].join("\n"));
  });

  it("uploads the clip", async () => {
    if (!existsSync(CLIP)) return console.log(`skipped: no clip at ${CLIP} (set SAMPLE_CLIP)`);
    const t0 = Date.now();
    const created = await api.createProject("Real run");
    const asset = await api.uploadFile(CLIP, "video/mp4", created.id);
    project = await api.setSource(created.id, asset.id);
    timings.push(["upload", (Date.now() - t0) / 1000]);
    expect(project.sourceAssetId).toBe(asset.id);
    console.log(`project ${project.id}`);
  }, SLOW);

  it("captions: real whisperX", async () => {
    if (!project) return;
    const { jobId } = await api.run(project.id, process.env.SAMPLE_LANGUAGE ? { language: process.env.SAMPLE_LANGUAGE } : {});
    const job = await waitJob(project.id, jobId, "captions");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    expect(project.phrases.length).toBeGreaterThan(0);
    const words = project.phrases.flatMap((p) => p.words);
    words.forEach((w, i) => { if (i) expect(w.startMs).toBeGreaterThanOrEqual(words[i - 1].startMs); });
    console.log(`language ${project.language}, ${words.length} words, estimated ${project.transcript?.estimatedWords ?? 0}, warnings ${project.warnings.join(",") || "none"}`);
    console.log(`first words: ${words.slice(0, 12).map((w) => w.text).join(" ")}`);
  }, SLOW);

  it("plan: real Ollama", async () => {
    if (!project) return;
    const { jobId } = await api.plan(project.id, { languages: [], burnInLanguage: null });
    const job = await waitJob(project.id, jobId, "plan");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    expect(project.editPlan!.shots.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(project.editPlan!.cuts)).toBe(true);
    for (const p of project.phrases) expect(p.words.filter((w) => w.emphasis).length).toBeLessThanOrEqual(2);
    console.log(`shots ${project.editPlan!.shots.map((s) => s.kind).join(", ")}; cuts ${project.editPlan!.cuts.length}; emphasis ${project.phrases.flatMap((p) => p.words).filter((w) => w.emphasis).length}; emoji ${project.phrases.filter((p) => p.emoji).length}`);
  }, SLOW);

  it("stock B-roll when Pexels is available (never fal)", async () => {
    if (!project) return;
    const pexels = (await api.catalog()).models.find((m) => m.provider === "pexels" && m.media === "image")!;
    if (!pexels.available) return console.log("broll skipped: PEXELS_KEY unset on the API");
    const r = await api.applyActions(project.id, { baseVersion: project.updatedAt, actions: [{ type: "setMediaSource", mediaSource: "stock" }], render: false });
    expect(r.project.mediaSource).toBe("stock");
    const { jobId } = await api.broll(project.id, { regenerate: false });
    const job = await waitJob(project.id, jobId, "broll");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    console.log(`overlays ${project.overlays.length}${project.overlays.length ? "" : `: ${project.warnings.filter((w) => w.startsWith("broll_not_found") || w === "no_broll_shots").join(",")}`}`);
    expect(project.creditsUsedCents).toBe(0);
  }, SLOW);

  it("render + frame", async () => {
    if (!project) return;
    const { jobId } = await api.render(project.id, { scale: 1 });
    const job = await waitJob(project.id, jobId, "render");
    project = await api.getProject(project.id);
    expect(job.state, job.error).toBe("COMPLETE");
    const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
    try {
      const mp4 = join(dir, "out.mp4");
      await api.downloadAsset(project.outputs.mp4AssetId!, mp4);
      const [durationS] = probe(mp4, "format=duration");
      // The plan enables pause/filler cuts: the MP4 is the kept length (as backend/mcp/tools.ts outputMs computes it).
      const outputMs = keptSegments(project.sourceDurationMs!, enabledCuts(project)).reduce((ms, s) => ms + s.endMs - s.startMs, 0);
      expect(Math.abs(durationS * 1000 - outputMs)).toBeLessThanOrEqual(100);
      expect(statSync(mp4).size).toBeGreaterThan(100_000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const { data, problems } = await api.frame(project.id, 1000, 540);
    expect(data.length).toBeGreaterThan(1024);
    expect(problems).toEqual([]);
  }, SLOW);
});

describe.skipIf(process.env.RUN_PIPELINE !== "1")("demo export timing (MG sandbox)", () => {
  const exportDemo = async (scale: 1 | 2) => {
    const t0 = Date.now();
    const { jobId } = await api.render("demo", { scale });
    const job = await waitJob("demo", jobId, `demo-${scale === 2 ? "4k" : "1080p"}`);
    expect(job.state, job.error).toBe("COMPLETE");
    const seconds = (Date.now() - t0) / 1000;
    const p = await api.getProject("demo");
    const dir = mkdtempSync(join(tmpdir(), "demo-"));
    try {
      const mp4 = join(dir, "demo.mp4");
      await api.downloadAsset(p.outputs.mp4AssetId!, mp4);
      expect(probe(mp4, "stream=width,height")).toEqual(scale === 2 ? [2160, 3840] : [1080, 1920]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    console.log(`demo export ${scale === 2 ? "4K" : "1080p"}: ${seconds.toFixed(1)} s (pre-sandbox 1080p baseline 14 s, 2026-10-22)`);
  };

  it("renders the demo at 1080p and 4K", async () => {
    const demo = await api.getProject("demo").catch((e) => (e instanceof SabiHttpError && e.status === 404 ? null : Promise.reject(e)));
    if (!demo) return console.log("skipped: no demo project (dev:lite seeds it)");
    await exportDemo(1);
    await exportDemo(2);
  }, SLOW);
});
