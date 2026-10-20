import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, sep } from "node:path";
import { z } from "zod";
import { ActionSchema, MAX_ACTIONS, TranslationLanguage } from "../../shared/contract";
import { deriveBeats } from "../../shared/editing/beats";
import { keptSegments, mapTime } from "../../shared/editing/cuts";
import { staleOverlays } from "../../shared/editing/overlays";
import { enabledCuts } from "../../shared/editing/renderProps";
import type { JobState, Project } from "../../shared/types";
import { SabiHttpError, SabiUnreachable, type SabiApi } from "./client";

export type ToolResult = { text: string; image?: { data: Buffer; mimeType: "image/png" }; isError?: boolean };

const RUNNING = ["transcribing", "planning", "generating", "rendering"];
const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const ASSET_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" };
const CAPTION_BAND_Y = 0.72; // a motion-graphic box reaching below this sits on the captions
const LIST_CAP = 30; // summary lists stay inside the token budget; the plan section has everything
const POLL_MS = 1000;

const pad = (n: number) => String(n).padStart(2, "0");
const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${pad(Math.floor((ms % 60_000) / 1000))}`;
const mmssd = (ms: number) => `${mmss(ms)}.${Math.floor((ms % 1000) / 100)}`;
const capped = (lines: string[], more: string) => (lines.length > LIST_CAP ? [...lines.slice(0, LIST_CAP), `… ${lines.length - LIST_CAP} more (${more})`] : lines);
const outputMs = (p: Project) => keptSegments(p.sourceDurationMs ?? 0, enabledCuts(p)).reduce((ms, s) => ms + s.endMs - s.startMs, 0);
const jobLine = (j: JobState) => `${j.kind} job ${j.state} ${Math.round(j.progress)}%${j.stage ? ` (${j.stage})` : ""}`;
const fail = (text: string): ToolResult => ({ text, isError: true });

// Paths come from the conversation: only the user's home tree, resolved through symlinks.
async function underHome(path: string) {
  const home = await realpath(homedir());
  const real = await realpath(path).catch(() => null);
  if (real === null) return null;
  return real === home || real.startsWith(home + sep) ? real : "outside";
}

function summary(p: Project) {
  const cuts = p.editPlan?.cuts ?? [];
  const on = cuts.filter((c) => c.shouldTrim);
  const words = p.phrases.reduce((n, ph) => n + ph.words.length, 0);
  const o = p.outputs;
  const stale = staleOverlays(p);
  return [
    `${p.title} (${p.id})`,
    `status ${p.status} · source ${mmss(p.sourceDurationMs ?? 0)} · output ${mmss(outputMs(p))} · ${p.language ?? "language ?"} · template ${p.captionTemplateId}`,
    `phrases ${p.phrases.length} · words ${words} · cuts ${on.length}/${cuts.length} on · shots ${p.editPlan?.shots.length ?? 0}` +
      ` · translations ${p.translations.map((t) => t.language).join(",") || "none"} · burn-in ${p.burnInLanguage ?? "none"}`,
    ...(p.editPlan ? [
      "shots:", ...capped(p.editPlan.shots.map((s) => `  ${s.id} ${s.kind} ${mmss(s.startMs)}–${mmss(s.endMs)}`), 'section: "plan"'),
      "enabled cuts:", ...capped(on.map((c) => `  ${c.id} ${c.reason} ${mmssd(c.startMs)}–${mmssd(c.endMs)} (on)`), 'section: "plan"'),
    ] : ["no edit plan yet (run_job plan)"]),
    `outputs: ${o.mp4AssetId ? `mp4 ${o.mp4AssetId}` : "none"}${o.srtAssetId ? " · srt · vtt" : ""}${o.translations?.length ? ` · ${o.translations.map((t) => t.language).join(",")}` : ""}`,
    `overlays ${p.overlays.length} (${p.overlays.filter((o) => o.enabled).length} on${stale.length ? `, ${stale.length} stale` : ""})` +
      ` · motion graphics ${p.motionGraphics.length} · brand ${p.brand ? `${p.brand.palette.primary} ${p.brand.fontFamily} grade ${p.brand.grade}` : "none"}`,
    `media source ${p.mediaSource}${p.creditsUsedCents ? ` · ${credits(p)}` : ""}`,
    ...(p.warnings.length ? [`warnings: ${p.warnings.join(", ")}`] : []),
    "times are source time; render_frame takes output time (shown as \"out\" when cuts are on)",
    `baseVersion: ${p.updatedAt}`,
  ].join("\n");
}

function phrasesPage(p: Project, offset: number, limit: number) {
  const cuts = enabledCuts(p);
  const page = p.phrases.slice(offset, offset + limit).map((ph) => {
    const text = ph.words.map((w) => (w.emphasis ? `*${w.text}*` : w.text)).join(" ");
    const out = cuts.length ? ` → out ${mmssd(mapTime(ph.startMs, cuts))}` : "";
    return `${ph.id} [${mmssd(ph.startMs)}–${mmssd(ph.endMs)}${out}] ${text}${ph.emoji ? ` (${ph.emoji})` : ""}`;
  });
  const next = offset + limit < p.phrases.length ? [`next offset ${offset + limit} (of ${p.phrases.length})`] : [];
  return [...page, ...next, `baseVersion: ${p.updatedAt}`].join("\n");
}

function searchWords(p: Project, search: string, offset: number, limit: number) {
  let re: RegExp;
  try { re = new RegExp(search, "i"); } catch { re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  const cuts = enabledCuts(p);
  const hits = p.phrases.flatMap((ph) => ph.words.filter((w) => re.test(w.text)).map((w) =>
    `"${w.text}" ${ph.id} ${w.id} ${mmssd(w.startMs)}–${mmssd(w.endMs)}${cuts.length ? ` (out ${mmssd(mapTime(w.startMs, cuts))})` : ""}`));
  const next = offset + limit < hits.length ? [`next offset ${offset + limit} (of ${hits.length})`] : [];
  return [`${hits.length} match(es) for /${search}/i`, ...hits.slice(offset, offset + limit), ...next, `baseVersion: ${p.updatedAt}`].join("\n");
}

function planSection(p: Project) {
  if (!p.editPlan) return `no edit plan yet (run_job plan)\nbaseVersion: ${p.updatedAt}`;
  return [
    "cuts:", ...p.editPlan.cuts.map((c) => `  ${c.id} ${c.reason} ${mmssd(c.startMs)}–${mmssd(c.endMs)}${c.text ? ` "${c.text}"` : ""} (${c.shouldTrim ? "on" : "off"})`),
    "shots:", ...p.editPlan.shots.map((s) => `  ${s.id} ${s.kind} ${mmssd(s.startMs)}–${mmssd(s.endMs)}`),
    `baseVersion: ${p.updatedAt}`,
  ].join("\n");
}

const credits = (p: Project) => `credits: $${(p.creditsUsedCents / 100).toFixed(2)} used`;

function brollSection(p: Project) {
  const stale = new Set(staleOverlays(p));
  const beats = p.editPlan ? deriveBeats(p.editPlan.shots, { allowVideo: p.mediaSource === "generate" }) : [];
  const b = p.brand;
  return [
    "beats:", ...(beats.length ? beats.map((x) => `  ${x.id} ${x.shotId} ${x.placement} ${mmssd(x.startMs)}–${mmssd(x.endMs)}`) : [p.editPlan ? "  none (no B-Roll shots)" : "  none (run_job plan)"]),
    "overlays:", ...(p.overlays.length ? p.overlays.map((o) => `  ${o.id} ${o.shotId} ${o.media} ${o.source} ${o.placement} ${mmssd(o.startMs)}–${mmssd(o.endMs)} ${o.enabled ? "on" : "off"}` +
      ` "${o.query}"${o.attribution ? ` (Photo: ${o.attribution.author} / Pexels)` : ""}${stale.has(o.id) ? " stale" : ""}`) : ["  none (run_job broll)"]),
    "motion graphics:", ...(p.motionGraphics.length ? p.motionGraphics.map((m) => `  ${m.id} "${m.name}" ${mmssd(m.startMs)}–${mmssd(m.endMs)} box ${m.box.x},${m.box.y} ${m.box.w}×${m.box.h}` +
      ` ${m.enabled ? "on" : "off"} props: ${m.props.map((x) => x.key).join(",") || "none"}${m.box.y + m.box.h > CAPTION_BAND_Y ? " ⚠ overlaps captions" : ""}`) : ["  none"]),
    b ? `brand: primary ${b.palette.primary} accent ${b.palette.accent} text ${b.palette.text} background ${b.palette.background} font ${b.fontFamily} logo ${b.logoAssetId ?? "none"} grade ${b.grade}`
      : "brand: none (template colours)",
    ...(p.creditsUsedCents ? [credits(p)] : []),
    `baseVersion: ${p.updatedAt}`,
  ].join("\n");
}

function outputsSection(p: Project) {
  const o = p.outputs;
  return [
    `mp4 ${o.mp4AssetId ?? "none"} · srt ${o.srtAssetId ?? "none"} · vtt ${o.vttAssetId ?? "none"}`,
    ...(o.translations ?? []).map((t) => `${t.language}: srt ${t.srtAssetId} · vtt ${t.vttAssetId}`),
    `baseVersion: ${p.updatedAt}`,
  ].join("\n");
}

const projectId = z.string().describe("Sabi project id (from list_projects)");

const TOOLS = {
  list_projects: {
    description: "List Sabi projects: id · title · status · duration · language.",
    inputSchema: {},
    run: async (api: SabiApi) => {
      const ps = await api.listProjects();
      if (!ps.length) return { text: "no projects yet; create_project {title, path}" };
      return { text: ps.map((p) => `${p.id} · ${p.title} · ${p.status} · ${mmss(p.sourceDurationMs ?? 0)} · ${p.language ?? "?"}`).join("\n") };
    },
  },
  inspect_project: {
    description: "Inspect a project. Default: a compact summary ending with baseVersion (pass it to apply_actions). " +
      'section "phrases" pages caption phrases (offset/limit); search finds words by regex with their times; "plan" lists all cuts and shots; ' +
      '"broll" lists beats, overlays, motion graphics and the brand kit; "outputs" lists rendered assets.',
    inputSchema: {
      projectId,
      section: z.enum(["summary", "phrases", "plan", "broll", "outputs"]).default("summary"),
      search: z.string().min(1).optional().describe("case-insensitive regex over caption words"),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(40),
    },
    run: async (api: SabiApi, i: { projectId: string; section: string; search?: string; offset: number; limit: number }) => {
      const p = await api.getProject(i.projectId);
      if (i.search) return { text: searchWords(p, i.search, i.offset, i.limit) };
      if (i.section === "phrases") return { text: phrasesPage(p, i.offset, i.limit) };
      if (i.section === "plan") return { text: planSection(p) };
      if (i.section === "broll") return { text: brollSection(p) };
      if (i.section === "outputs") return { text: outputsSection(p) };
      return { text: summary(p) };
    },
  },
  render_frame: {
    description: "Render one still of the OUTPUT timeline (cuts applied, exactly as the MP4 exports) to verify an edit. Max 4 per turn.",
    inputSchema: {
      projectId,
      timestampMs: z.number().describe("output-timeline ms; clamped to [0, duration]"),
      width: z.number().int().default(540).describe("PNG width, 160–1080"),
    },
    run: async (api: SabiApi, i: { projectId: string; timestampMs: number; width: number }): Promise<ToolResult> => {
      const { data, ms } = await api.frame(i.projectId, i.timestampMs, i.width);
      return { image: { data, mimeType: "image/png" }, text: `frame at ${mmssd(ms)} (output timeline)` };
    },
  },
  apply_actions: {
    description: "Apply typed edits atomically (all or nothing): setTitle, editPhrase, setCut, setShotKind, setTemplate, setBurnIn, " +
      "setMediaSource, setOverlay, removeOverlay, replaceOverlay, setBrand, addMotionGraphic, updateMotionGraphic, removeMotionGraphic (see the sabi-editor skill). " +
      "Pass the baseVersion from your last inspect_project; render:true also starts a re-render (otherwise verify with render_frame first).",
    inputSchema: {
      projectId,
      baseVersion: z.string(),
      actions: z.array(ActionSchema).min(1).max(MAX_ACTIONS),
      render: z.boolean().default(false),
    },
    run: async (api: SabiApi, i: { projectId: string; baseVersion: string; actions: z.infer<typeof ActionSchema>[]; render: boolean }) => {
      try {
        const r = await api.applyActions(i.projectId, { baseVersion: i.baseVersion, actions: i.actions, render: i.render });
        return { text: `applied ${r.applied} action(s); baseVersion now ${r.project.updatedAt}${r.jobId ? `; render job ${r.jobId} started (wait_job)` : ""}` };
      } catch (e) {
        if (e instanceof SabiHttpError && e.body.error === "stale") return fail(`project changed since baseVersion ${i.baseVersion} (now ${e.body.currentVersion}); re-run inspect_project`);
        throw e;
      }
    },
  },
  run_job: {
    description: 'Start a job: "captions" (transcribe + captions + render), "plan" (cuts, shots, emphasis, emoji, translations; local Ollama), "render" (re-render current edits), ' +
      '"broll" (stock or fal.ai media for every B-Roll shot, then render; generate mode spends fal credits).',
    inputSchema: {
      projectId,
      kind: z.enum(["captions", "plan", "render", "broll"]),
      languages: z.array(TranslationLanguage).max(3).optional().describe("plan only: translated subtitle tracks"),
      burnInLanguage: TranslationLanguage.nullable().optional().describe("plan only: burn this translation into the MP4"),
      regenerate: z.boolean().optional().describe("broll only: replace every overlay instead of keeping matching ones"),
      overlayId: z.string().optional().describe("broll only: re-pick just this overlay (next stock result or a new generation)"),
      query: z.string().max(200).optional().describe("broll + overlayId only: new stock search words"),
      prompt: z.string().max(600).optional().describe("broll + overlayId only: new generation prompt"),
    },
    run: async (api: SabiApi, i: {
      projectId: string; kind: "captions" | "plan" | "render" | "broll"; languages?: z.infer<typeof TranslationLanguage>[]; burnInLanguage?: z.infer<typeof TranslationLanguage> | null;
      regenerate?: boolean; overlayId?: string; query?: string; prompt?: string;
    }) => {
      const { jobId } = i.kind === "captions" ? await api.run(i.projectId)
        : i.kind === "plan" ? await api.plan(i.projectId, { languages: i.languages ?? [], burnInLanguage: i.burnInLanguage ?? null })
          : i.kind === "broll" ? await api.broll(i.projectId, { regenerate: i.regenerate ?? false, overlayId: i.overlayId, query: i.query, prompt: i.prompt })
            : await api.render(i.projectId);
      return { text: `job ${jobId} (${i.kind}) started; next: wait_job` };
    },
  },
  wait_job: {
    description: "Wait until the project's running job finishes (polls every second). Reports status, last stage and warnings.",
    inputSchema: { projectId, timeoutMs: z.number().int().min(0).default(600_000) },
    run: async (api: SabiApi, i: { projectId: string; timeoutMs: number }): Promise<ToolResult> => {
      const t0 = Date.now();
      for (;;) {
        const job = await api.getJob(i.projectId); // running job, else the last finished one
        const p = await api.getProject(i.projectId);
        const secs = Math.round((Date.now() - t0) / 1000);
        const running = job?.state === "QUEUED" || job?.state === "PROCESSING";
        if (!running && !RUNNING.includes(p.status)) {
          // A failed plan restores the previous status, so the job's own state is the only sign it failed.
          const outcome = job ? `; last job ${job.kind} ${job.state}${job.error ? `: ${job.error}` : ""}` : "";
          const text = `status ${p.status} after ${secs}s${outcome}${p.warnings.length ? `; warnings: ${p.warnings.join(", ")}` : ""}`;
          return p.status === "failed" || job?.state === "FAILED" ? fail(text) : { text };
        }
        const stage = job ? `; ${jobLine(job)}` : "";
        if (Date.now() - t0 >= i.timeoutMs) return fail(`still ${p.status} after ${secs}s${stage}; call wait_job again`);
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
  },
  create_project: {
    description: "Create a project from a local video/audio file under your home directory (.mp4 .mov .mp3 .wav) and upload it. Next: run_job captions.",
    inputSchema: { title: z.string().min(1).max(200), path: z.string().describe("absolute path under $HOME") },
    run: async (api: SabiApi, i: { title: string; path: string }) => {
      const real = await underHome(i.path);
      if (real === null) return fail(`no such file: ${i.path}`);
      if (real === "outside") return fail(`refused: ${i.path} is outside your home directory`);
      const mimeType = MIME[extname(real).toLowerCase()];
      if (!mimeType) return fail(`unsupported file type ${extname(real) || "(none)"}; use ${Object.keys(MIME).join(" ")}`);
      const project = await api.createProject(i.title);
      const asset = await api.uploadFile(real, mimeType, project.id);
      await api.setSource(project.id, asset.id);
      return { text: `project ${project.id} created; next: run_job captions` };
    },
  },
  upload_asset: {
    description: "Upload an image (.png .jpg .webp) or video (.mp4 .mov) under your home directory into a project, for replaceOverlay, setBrand.logoAssetId or an image prop.",
    inputSchema: { projectId, path: z.string().describe("absolute path under $HOME") },
    run: async (api: SabiApi, i: { projectId: string; path: string }) => {
      const real = await underHome(i.path);
      if (real === null) return fail(`no such file: ${i.path}`);
      if (real === "outside") return fail(`refused: ${i.path} is outside your home directory`);
      const mimeType = ASSET_MIME[extname(real).toLowerCase()];
      if (!mimeType) return fail(`unsupported file type ${extname(real) || "(none)"}; use ${Object.keys(ASSET_MIME).join(" ")}`);
      const a = await api.uploadFile(real, mimeType, i.projectId);
      return { text: `asset ${a.id} (${a.kind} ${a.width ?? "?"}×${a.height ?? "?"}); use it in replaceOverlay, setBrand.logoAssetId or an image prop` };
    },
  },
  export_outputs: {
    description: "Write the rendered MP4 and SRT/VTT (plus translated tracks) into an existing directory under your home directory.",
    inputSchema: { projectId, outDir: z.string().describe("existing directory under $HOME") },
    run: async (api: SabiApi, i: { projectId: string; outDir: string }) => {
      const dir = await underHome(i.outDir);
      if (dir === "outside") return fail(`refused: ${i.outDir} is outside your home directory`);
      if (dir === null || !(await stat(dir)).isDirectory()) return fail(`no such directory: ${i.outDir}`);
      const p = await api.getProject(i.projectId);
      const o = p.outputs;
      if (!o.mp4AssetId) return fail("no outputs yet; run_job captions (or render) first");
      const title = p.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || p.id;
      const files = (base: string): [string | undefined, string][] => [
        [o.mp4AssetId, `${base}.mp4`], [o.srtAssetId, `${base}.srt`], [o.vttAssetId, `${base}.vtt`],
        ...(o.translations ?? []).flatMap((t): [string, string][] => [[t.srtAssetId, `${base}.${t.language}.srt`], [t.vttAssetId, `${base}.${t.language}.vtt`]]),
      ];
      // Never overwrite (or follow a symlink at) an existing name: pick "<title> (n)" free for the whole set; downloads open with wx.
      const taken = async (base: string) => (await Promise.all(files(base).map(([, name]) => lstat(join(dir, name)).then(() => true, () => false)))).some(Boolean);
      let base = title;
      for (let n = 2; await taken(base); n++) base = `${title} (${n})`;
      const written: string[] = [];
      for (const [id, name] of files(base)) {
        if (!id) continue;
        await api.downloadAsset(id, join(dir, name));
        written.push(join(dir, name));
      }
      return { text: `wrote ${written.length} file(s):\n${written.join("\n")}` };
    },
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];
export const toolSpec = (name: ToolName) => ({ description: TOOLS[name].description, inputSchema: TOOLS[name].inputSchema });

const UNREACHABLE = (url: string) => `Sabi API not reachable at ${url} — start it with \`npm run dev:lite\` (or the "api-lite-fake" launch config)`;

// Every tool funnels through here: inputs are parsed (defaults applied), API failures become isError text.
export async function callTool(api: SabiApi, name: ToolName, input: unknown): Promise<ToolResult> {
  const tool = TOOLS[name];
  try {
    const parsed = z.object(tool.inputSchema).parse(input ?? {});
    return await (tool.run as (api: SabiApi, i: unknown) => Promise<ToolResult>)(api, parsed);
  } catch (e) {
    if (e instanceof SabiUnreachable) return fail(UNREACHABLE(e.baseUrl));
    if (e instanceof SabiHttpError) {
      const { error, job, ...rest } = e.body as { error?: string; job?: JobState };
      if (error === "busy") return fail(`busy: ${job ? jobLine(job) : "a job is running"}; call wait_job, then re-run inspect_project`);
      return fail(`${e.status} ${error ?? "error"}${Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ""}`);
    }
    if (e instanceof z.ZodError) return fail(`invalid input: ${e.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    return fail(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
