import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Uploaded files are untrusted: a crafted playlist could make ffmpeg read local files or URLs. Lock protocols and demuxers.
const SAFE = ["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,mp3,wav"];

export interface MediaInfo { durationMs: number; width?: number; height?: number }

export interface Media {
  probe(path: string): Promise<MediaInfo>;
  extractAudio(input: string, outWav: string): Promise<void>; // 16 kHz mono PCM for the transcriber
}

export class FfmpegMedia implements Media {
  async probe(path: string): Promise<MediaInfo> {
    const { stdout } = await run("ffprobe", ["-v", "error", ...SAFE, "-show_entries", "format=duration:stream=width,height", "-of", "json", "--", path]);
    const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { width?: number; height?: number }[] };
    const v = j.streams?.find((s) => s.width && s.height);
    return { durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000), width: v?.width, height: v?.height };
  }
  async extractAudio(input: string, outWav: string) {
    await run("ffmpeg", ["-y", "-v", "error", ...SAFE, "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outWav]);
  }
}

export class FakeMedia implements Media {
  constructor(private info: MediaInfo) {}
  async probe() { return this.info; }
  async extractAudio() {}
}
