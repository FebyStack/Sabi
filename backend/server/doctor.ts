import { execFile } from "node:child_process";
import { lstat, readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseSpendCap } from "../modules/usage/spend";
import { MIN_FREE_BYTES, freeBytesOf } from "../shared/disk";
import { OllamaLlm, type LlmHealth } from "../shared/llm";
import { WhisperXTranscriber } from "../shared/transcriber";

// `npm run doctor` (spec row 28): what a real run needs, checked before it. Reports and prints the fix; never deletes,
// never prints a key, never calls fal (every fal call is billed). Everything machine-specific comes in through `io`.
export type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; hint?: string };
export type DoctorIo = {
  freeBytes(path: string): Promise<number>;
  stat(path: string): Promise<{ isDir: boolean; isSymlink: boolean; mtimeMs: number } | null>;
  readdir(path: string): Promise<string[]>; // names; [] when missing
  dirBytes(path: string): Promise<number>;
  which(bin: string): Promise<string | null>;
  run(cmd: string, args: string[]): Promise<string>; // stdout; throws on a non-zero exit
  fetch: typeof fetch;
  transcriber: { health(): Promise<"ok" | "down"> };
  llm: { health(): Promise<LlmHealth> };
  pgPing(url: string): Promise<void>;
  redisPing(url: string): Promise<void>;
  now(): number;
};
export type DoctorPaths = { home: string; tmp: string; repo: string; dataDir: string; depsDir: string; tmpDir: string };

const GiB = 1024 ** 3;
const WARN_BYTES = 10 * GiB;
const DAY_MS = 86_400_000;
const gib = (n: number) => `${(n / GiB).toFixed(1)} GiB`;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runDoctor(env: NodeJS.ProcessEnv, io: DoctorIo, paths: DoctorPaths): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string, hint?: string) => checks.push({ name, status, detail, ...(hint ? { hint } : {}) });

  // Volumes: renders refuse under the floor (row 30), so the doctor fails there too.
  const room = async (name: string, path: string, floor = true) => {
    const free = await io.freeBytes(path);
    const status = floor && free < MIN_FREE_BYTES ? "fail" : free < WARN_BYTES ? "warn" : "ok";
    add(name, status, `${gib(free)} free (${path})`, status === "ok" ? undefined : "see stale deps / stale tmp below, then empty the Trash");
  };
  await room("temp volume", paths.tmp);
  for (const [name, dir] of [["DATA_DIR", paths.dataDir], ...(env.WORK_DIR ? [["WORK_DIR", env.WORK_DIR]] : [])] as const) {
    if (!(await io.stat(dir))?.isDir) add(name, "fail", `missing (${dir})`, "is the PortableSSD plugged in?");
    else await room(name, dir);
  }
  await room("repo volume", paths.repo, false);
  const sabiDev = join(paths.home, "SabiDev");
  if ((await io.stat(sabiDev))?.isDir) add("SabiDev mount", "ok", sabiDev);
  else add("SabiDev mount", "fail", `not mounted (${sabiDev})`, "plug in the SSD; the login item mounts it within ~10 s");
  const modules = await io.stat(join(paths.repo, "node_modules"));
  if (modules?.isSymlink) add("node_modules link", "ok", `→ ${paths.depsDir}`);
  else add("node_modules link", "fail", modules ? "a real folder on the SSD" : "missing", "npm run deps (never plain npm install)");

  // Sabi's own leftovers on the Mac disk, with the exact removal commands (run by hand).
  const porcelain = await io.run("git", ["-C", paths.repo, "worktree", "list", "--porcelain"]).catch(() => "");
  const trees = porcelain.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length));
  const live = new Set(trees.map((t, i) => (i === 0 ? "main" : basename(t)))); // deps.sh names the main checkout "main"
  const staleDeps = (await io.readdir(paths.depsDir)).filter((n) => !n.startsWith(".") && !live.has(n)).map((n) => join(paths.depsDir, n));
  const staleTmp: string[] = [];
  for (const n of await io.readdir(paths.tmpDir)) {
    const s = await io.stat(join(paths.tmpDir, n));
    if (s && s.mtimeMs < io.now() - DAY_MS) staleTmp.push(join(paths.tmpDir, n));
  }
  for (const [name, list, what] of [["stale deps", staleDeps, "node_modules of no worktree"], ["stale tmp", staleTmp, "older than a day"]] as const) {
    if (!list.length) { add(name, "ok", "none"); continue; }
    let bytes = 0;
    for (const p of list) bytes += await io.dirBytes(p);
    add(name, "warn", `${list.length} ${what}, ${gib(bytes)}`, list.map((p) => `rm -rf ${p}`).join("; "));
  }

  // Tools.
  const ffmpeg = await io.run("ffmpeg", ["-version"]).catch(() => null);
  if (ffmpeg) add("ffmpeg", "ok", ffmpeg.match(/version (\S+)/)?.[1] ?? "installed");
  else add("ffmpeg", "fail", "not found", "brew install ffmpeg");
  const uv = await io.which("uv");
  if (uv) add("uv", "ok", uv);
  else add("uv", "fail", "not found (whisperX and npm run verify need it)", "brew install uv");
  const ollamaBin = env.OLLAMA_BIN || "ollama";
  const ollamaFound = ollamaBin.includes("/") ? ((await io.stat(ollamaBin)) ? ollamaBin : null) : await io.which(ollamaBin);
  if (ollamaFound) add("ollama binary", "ok", ollamaFound);
  else add("ollama binary", "fail", `not found (${ollamaBin})`, "export OLLAMA_BIN=~/SabiDev/bin/ollama-dist/ollama (official tarball, PROJECT.md)");
  if (await io.stat(join(paths.repo, "node_modules/.remotion/chrome-headless-shell"))) add("remotion browser", "ok", "chrome-headless-shell present");
  else add("remotion browser", "warn", "not downloaded", "the first render downloads 570 MB to the Mac disk");

  // Local services, through the same probes /api/health uses.
  if ((await io.transcriber.health()) === "ok") add("whisperX", "ok", "running");
  else add("whisperX", "fail", "not running", "npm run ai:whisperx");
  const llm = await io.llm.health();
  const pull = `${env.OLLAMA_BIN ? '"$OLLAMA_BIN"' : "ollama"} pull ${llm.model}`;
  if (llm.status === "ok") add("Ollama", "ok", `model ${llm.model}`);
  else if (llm.status === "model_missing") add("Ollama", "fail", `no ${llm.model}`, pull);
  else add("Ollama", "fail", "not running", "npm run ai:ollama");
  const service = async (name: string, ping: () => Promise<unknown>) => {
    await ping().then(() => add(name, "ok", "answers"), (err) => add(name, "fail", errText(err), "make db (Docker Desktop must be running)"));
  };
  if (env.DATABASE_URL) await service("Postgres", () => io.pgPing(env.DATABASE_URL!));
  if (env.S3_ENDPOINT) await service("MinIO", () => io.fetch(env.S3_ENDPOINT!, { signal: AbortSignal.timeout(3000) })); // any HTTP answer = up
  if (env.REDIS_URL) await service("Redis", () => io.redisPing(env.REDIS_URL!));

  // Keys: Pexels verified with one search (1 of its 200 requests an hour); fal only reported, since every fal call costs.
  const pexels = env.PEXELS_KEY?.trim();
  if (!pexels) add("PEXELS_KEY", "warn", "unset", "set PEXELS_KEY in the API's shell for stock B-roll");
  else {
    const res = await io.fetch("https://api.pexels.com/v1/search?query=sky&per_page=1", { headers: { authorization: pexels }, signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (res?.ok) add("PEXELS_KEY", "ok", "verified");
    else if (res?.status === 401 || res?.status === 403) add("PEXELS_KEY", "fail", `rejected (${res.status})`, "check the key at https://www.pexels.com/api/");
    else add("PEXELS_KEY", "warn", res ? `could not verify (HTTP ${res.status})` : "could not verify (Pexels not reachable)");
  }
  add("FAL_KEY", "ok", env.FAL_KEY?.trim() ? "set" : "unset");
  try {
    const cap = parseSpendCap(env.SPEND_CAP_CENTS);
    add("SPEND_CAP_CENTS", "ok", cap ? `$${(cap / 100).toFixed(2)} a month` : "no cap");
  } catch (err) {
    add("SPEND_CAP_CENTS", "fail", errText(err));
  }

  // The Tagalog fixture for npm run transcribe:sample (only the owner can record it).
  const wav = join(paths.repo, "ai/evaluation/fixtures/tagalog-sample.wav");
  const record = "ffmpeg -i rec.m4a -ac 1 -ar 16000 ai/evaluation/fixtures/tagalog-sample.wav";
  if (!(await io.stat(wav))) add("tagalog sample", "warn", "not recorded (npm run transcribe:sample skips)", `read ai/evaluation/fixtures/tagalog-sample.txt aloud, then ${record}`);
  else {
    const out = await io.run("ffprobe", ["-v", "error", "-show_entries", "stream=sample_rate,channels", "-of", "default=nw=1:nk=1", wav]).catch(() => "");
    const nums = out.split("\n").map(Number).filter((n) => n > 0);
    const rate = nums.find((n) => n > 1000), channels = nums.find((n) => n < 10);
    if (rate === 16000 && channels === 1) add("tagalog sample", "ok", "16 kHz mono");
    else add("tagalog sample", "warn", `${rate ?? "?"} Hz, ${channels ?? "?"} ch`, record);
  }
  return checks;
}

const LABEL = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;
export function formatReport(checks: Check[]): string {
  return checks.map((c) => `${LABEL[c.status]} ${c.name} — ${c.detail}${c.hint ? ` (${c.hint})` : ""}`).join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = process.env;
  const run = async (cmd: string, args: string[]) => (await promisify(execFile)(cmd, args, { maxBuffer: 1024 ** 2 })).stdout;
  const io: DoctorIo = {
    freeBytes: freeBytesOf,
    stat: async (p) => {
      const l = await lstat(p).catch(() => null);
      if (!l) return null;
      return { isDir: (await stat(p).catch(() => null))?.isDirectory() ?? false, isSymlink: l.isSymbolicLink(), mtimeMs: l.mtimeMs };
    },
    readdir: (p) => readdir(p).catch(() => []),
    dirBytes: async (p) => Number((await run("du", ["-sk", p]).catch(() => "0")).split(/\s/)[0]) * 1024,
    which: (bin) => run("which", [bin]).then((s) => s.trim() || null, () => null),
    run,
    fetch: globalThis.fetch,
    transcriber: new WhisperXTranscriber(env.WHISPERX_URL ?? "http://localhost:8010"),
    llm: new OllamaLlm(env.OLLAMA_URL ?? "http://localhost:11434", env.OLLAMA_MODEL ?? "qwen2.5:3b"),
    pgPing: async (url) => {
      const { createPool } = await import("../shared/pg");
      const pool = createPool(url);
      try { await pool.query("SELECT 1"); } finally { await pool.end(); }
    },
    redisPing: async (url) => {
      const { Redis } = await import("ioredis");
      const redis = new Redis(url, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null });
      try { await redis.connect(); await redis.ping(); } finally { redis.disconnect(); }
    },
    now: Date.now,
  };
  const home = homedir();
  const checks = await runDoctor(env, io, {
    home, tmp: tmpdir(), repo: process.cwd(), dataDir: env.DATA_DIR ?? "/Volumes/PortableSSD/Bong/captions-clone-data",
    depsDir: join(home, "Developer/.sabi-deps"), tmpDir: join(home, "Developer/.sabi-tmp"),
  });
  console.log(formatReport(checks));
  process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
}
