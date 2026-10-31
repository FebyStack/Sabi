import { readFile } from "node:fs/promises";
import type { Transcript } from "../../shared/types";

export interface Transcriber {
  transcribe(wavPath: string, opts?: { language?: string }): Promise<Transcript>;
  health(): Promise<"ok" | "down">; // GET /api/health and npm run doctor (spec row 32)
}

type SidecarWord = { text: string; start: number; end: number; score?: number };

const unavailable = () => new Error("transcriber_unavailable");
// Short, so a stopped sidecar never stalls the health route; it answers mid-clip (transcribe runs in a thread).
const PROBE_MS = 1500;

// Talks to ai/transcription/server.py (whisperX). Seconds on the wire, ms in the domain.
export class WhisperXTranscriber implements Transcriber {
  constructor(private baseUrl: string, private opts: { timeoutMs?: number } = {}) {}

  async transcribe(wavPath: string, opts: { language?: string } = {}): Promise<Transcript> {
    const form = new FormData();
    form.append("file", new Blob([await readFile(wavPath)], { type: "audio/wav" }), "audio.wav");
    if (opts.language) form.append("language", opts.language);
    // CPU int8 whisperX on a 10-minute clip can take a while; a hung sidecar must still fail the job.
    const res = await fetch(`${this.baseUrl}/transcribe`, { method: "POST", body: form, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30 * 60_000) })
      .catch((err: Error) => { throw new Error(err.name === "TimeoutError" ? "transcriber_timeout" : "transcriber_unavailable"); });
    if (res.status >= 400 && res.status < 500) throw new Error("transcriber_rejected"); // e.g. 400 unknown_language
    if (!res.ok) throw unavailable();
    const body: { language?: unknown; words?: unknown; estimated_words?: unknown } = await res.json().catch(() => { throw unavailable(); });
    if (typeof body.language !== "string" || !Array.isArray(body.words)) throw unavailable();
    const estimated = typeof body.estimated_words === "number" ? body.estimated_words : 0; // older sidecars omit it
    return {
      language: body.language,
      ...(estimated > 0 ? { estimatedWords: estimated } : {}),
      words: (body.words as SidecarWord[]).map((w, i) => ({
        id: `w-${i}`, text: w.text, startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000),
        ...(w.score !== undefined ? { confidence: w.score } : {}),
      })),
    };
  }

  async health(): Promise<"ok" | "down"> {
    const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(PROBE_MS) }).catch(() => null);
    return res?.ok ? "ok" : "down";
  }
}

export class FakeTranscriber implements Transcriber {
  calls = 0;
  languages: (string | undefined)[] = []; // the language each call asked for
  constructor(private transcript: Transcript) {}
  async transcribe(_wav: string, opts: { language?: string } = {}) {
    this.calls++;
    this.languages.push(opts.language);
    return structuredClone(this.transcript);
  }
  async health() { return "ok" as const; }
}
