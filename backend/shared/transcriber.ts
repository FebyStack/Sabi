import { readFile } from "node:fs/promises";
import type { Transcript } from "../../shared/types";

export interface Transcriber {
  transcribe(wavPath: string, opts?: { language?: string }): Promise<Transcript>;
}

type SidecarWord = { text: string; start: number; end: number; score?: number };

// Talks to ai/transcription/server.py (whisperX). Seconds on the wire, ms in the domain.
export class WhisperXTranscriber implements Transcriber {
  constructor(private baseUrl: string) {}

  async transcribe(wavPath: string, opts: { language?: string } = {}): Promise<Transcript> {
    const form = new FormData();
    form.append("file", new Blob([await readFile(wavPath)], { type: "audio/wav" }), "audio.wav");
    if (opts.language) form.append("language", opts.language);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/transcribe`, { method: "POST", body: form });
    } catch {
      throw new Error("transcriber_unavailable");
    }
    if (!res.ok) throw new Error("transcriber_unavailable");
    const body = (await res.json()) as { language: string; words: SidecarWord[] };
    return {
      language: body.language,
      words: body.words.map((w, i) => ({
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
