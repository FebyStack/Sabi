import { MIN_FREE_BYTES } from "../shared/disk";
import { type Check, type DoctorIo, formatReport, runDoctor } from "./doctor";

const GiB = 1024 ** 3;
const paths = { home: "/h", tmp: "/h/Developer/.sabi-tmp", repo: "/h/SabiDev/repo", dataDir: "/ssd/data", depsDir: "/h/Developer/.sabi-deps", tmpDir: "/h/Developer/.sabi-tmp" };
const io = (over: Partial<DoctorIo> = {}): DoctorIo => ({
  freeBytes: async () => 20 * GiB,
  stat: async (p) => (p === "/h/SabiDev/repo/node_modules" ? { isDir: true, isSymlink: true, mtimeMs: 0 } : { isDir: true, isSymlink: false, mtimeMs: Date.now() }),
  readdir: async (p) => (p === paths.depsDir ? ["main", "objective-lamarr-f09862", "old-branch", ".remotion"] : p === paths.tmpDir ? ["bench-1", "fresh"] : []),
  dirBytes: async () => 600 * 1024 ** 2,
  which: async (bin) => (bin === "ollama" ? null : `/opt/homebrew/bin/${bin}`),
  run: async (cmd, args) => (cmd === "git" ? "worktree /h/SabiDev/repo\nbranch refs/heads/main\n\nworktree /h/SabiDev/repo/.claude/worktrees/objective-lamarr-f09862\nbranch refs/heads/x\n" : args.includes("stream=sample_rate,channels") ? "16000\n1\n" : "ffmpeg version 8.1.2 Copyright"),
  fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch,
  transcriber: { health: async () => "ok" },
  llm: { health: async () => ({ status: "ok", model: "qwen2.5:3b" }) },
  pgPing: async () => {},
  redisPing: async () => {},
  now: () => Date.now(),
  ...over,
});
const by = (checks: Check[], name: string) => checks.find((c) => c.name === name)!;

describe("npm run doctor", () => {
  it("a healthy machine with nothing set: ok everywhere except the keys and the WAV", async () => {
    const checks = await runDoctor({ OLLAMA_BIN: "/h/SabiDev/bin/ollama-dist/ollama" }, io({ readdir: async (p) => (p === paths.depsDir ? ["main", "objective-lamarr-f09862", ".remotion"] : []) }), paths);
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(by(checks, "PEXELS_KEY")).toMatchObject({ status: "warn", detail: "unset" });
    expect(by(checks, "FAL_KEY")).toMatchObject({ status: "ok", detail: "unset" });
    expect(by(checks, "ollama binary").status).toBe("ok"); // the path is stat'ed, not which'ed
    expect(by(checks, "ffmpeg")).toMatchObject({ status: "ok", detail: "8.1.2" });
    expect(by(checks, "tagalog sample").status).toBe("ok");
    expect(checks.map((c) => c.name)).not.toContain("Postgres"); // DATABASE_URL unset
  });

  it("flags a full temp volume, stale deps and tmp entries, a missing model and a missing binary", async () => {
    const stale = async (p: string) => (p === `${paths.tmpDir}/bench-1` ? { isDir: true, isSymlink: false, mtimeMs: Date.now() - 2 * 86_400_000 } : { isDir: true, isSymlink: false, mtimeMs: Date.now() });
    const checks = await runDoctor({}, io({
      freeBytes: async (p) => (p === paths.tmp ? MIN_FREE_BYTES - 1 : 20 * GiB), stat: stale,
      llm: { health: async () => ({ status: "model_missing", model: "qwen2.5:3b" }) },
    }), paths);
    expect(by(checks, "temp volume").status).toBe("fail");
    expect(by(checks, "stale deps")).toMatchObject({ status: "warn", hint: expect.stringContaining("rm -rf /h/Developer/.sabi-deps/old-branch") });
    expect(by(checks, "stale deps").hint).not.toContain("objective-lamarr");
    expect(by(checks, "stale tmp")).toMatchObject({ status: "warn", hint: expect.stringContaining("rm -rf /h/Developer/.sabi-tmp/bench-1") });
    expect(by(checks, "stale tmp").hint).not.toContain("fresh");
    expect(by(checks, "Ollama")).toMatchObject({ status: "fail", hint: expect.stringContaining("ollama pull qwen2.5:3b") });
    expect(by(checks, "ollama binary").status).toBe("fail");
    expect(by(checks, "node_modules link").status).toBe("fail"); // a real folder: npm install replaced the link
  });

  it("checks Postgres, MinIO and Redis only when configured, and says how to start them", async () => {
    const env = { DATABASE_URL: "postgres://x@localhost:5433/c", S3_ENDPOINT: "http://localhost:9000", REDIS_URL: "redis://localhost:6379" };
    const up = await runDoctor(env, io(), paths);
    expect(["Postgres", "MinIO", "Redis"].map((n) => by(up, n).status)).toEqual(["ok", "ok", "ok"]);
    const down = await runDoctor(env, io({ pgPing: async () => { throw new Error("ECONNREFUSED"); }, redisPing: async () => { throw new Error("ECONNREFUSED"); },
      fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch }), paths);
    for (const n of ["Postgres", "MinIO", "Redis"]) expect(by(down, n)).toMatchObject({ status: "fail", hint: expect.stringContaining("make db") });
  });

  it("verifies PEXELS_KEY with one search and never prints it", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ photos: [] }), { status: calls.length === 1 ? 200 : 401 });
    }) as typeof fetch;
    const ok = await runDoctor({ PEXELS_KEY: "abc123secret" }, io({ fetch: fetchFn }), paths);
    expect(by(ok, "PEXELS_KEY")).toMatchObject({ status: "ok", detail: "verified" });
    expect(calls).toEqual([{ url: "https://api.pexels.com/v1/search?query=sky&per_page=1", auth: "abc123secret" }]);
    const bad = await runDoctor({ PEXELS_KEY: "abc123secret", FAL_KEY: "fal-secret" }, io({ fetch: fetchFn }), paths);
    expect(by(bad, "PEXELS_KEY")).toMatchObject({ status: "fail", detail: "rejected (401)" });
    expect(by(bad, "FAL_KEY")).toMatchObject({ status: "ok", detail: "set" });
    expect(calls).toHaveLength(2); // FAL_KEY is never used: every fal call is billed
    const report = formatReport([...ok, ...bad]);
    expect(report).not.toContain("abc123secret");
    expect(report).not.toContain("fal-secret");
  });

  it("formatReport is one line per check", () => {
    const text = formatReport([{ name: "ffmpeg", status: "ok", detail: "8.1.2" }, { name: "whisperX", status: "fail", detail: "down", hint: "npm run ai:whisperx" }]);
    expect(text.split("\n")).toEqual(["ok   ffmpeg — 8.1.2", "FAIL whisperX — down (npm run ai:whisperx)"]);
  });
});
