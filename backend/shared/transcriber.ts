import { readFile } from "node:fs/promises";
import type { Transcript } from "../../shared/types";

export interface Transcriber {
  transcribe(wavPath: string, opts?: { language?: string }): Promise<Transcript>;
}

type SidecarWord = { text: string; start: number; end: number; score?: number };

const unavailable = () => new Error("transcriber_unavailable");

// Talks to ai/transcription/server.py (whisperX). Seconds on the wire, ms in the domain.
export class WhisperXTranscriber implements Transcriber {
  constructor(private baseUrl: string, private opts: { timeoutMs?: number } = {}) {}

  async transcribe(wavPath: string, opts: { language?: string } = {}): Promise<Transcript> {
    const form = new FormData();
    form.append("file", new Blob([await readFile(wavPath)], { type: "audio/wav" }), "audio.wav");
    if (opts.language) form.append("language", opts.language);
    let body: { language?: unknown; words?: unknown; estimated_words?: unknown };
    try {
      // CPU int8 whisperX on a 10-minute clip can take a while; a hung sidecar must still fail the job.
      const res = await fetch(`${this.baseUrl}/transcribe`, { method: "POST", body: form, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30 * 60_000) });
      if (!res.ok) throw unavailable();
      body = await res.json();
    } catch {
      throw unavailable();
    }
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
}

export class FakeTranscriber implements Transcriber {
  calls = 0;
  constructor(private transcript: Transcript) {}
  async transcribe() { this.calls++; return structuredClone(this.transcript); }
}
