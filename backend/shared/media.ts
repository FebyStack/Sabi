import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Uploaded files are untrusted: a crafted playlist could make ffmpeg read local files or URLs. Lock protocols and demuxers.
const SAFE = ["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,mp3,wav,image2,png_pipe,jpeg_pipe,webp_pipe"];

export interface MediaInfo { durationMs: number; width?: number; height?: number }

export interface Media {
  probe(path: string): Promise<MediaInfo>;
  extractAudio(input: string, outWav: string): Promise<void>; // 16 kHz mono PCM for the transcriber
}

export type ProbeJson = {
  format?: { duration?: string };
  streams?: { codec_type?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
};

// Phone clips are often stored landscape with a ±90° rotation tag; report the displayed orientation.
export function parseProbe(j: ProbeJson): MediaInfo {
  const v = j.streams?.find((s) => s.codec_type === "video" && s.width && s.height);
  const info: MediaInfo = { durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000) };
  if (!v) return info;
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  return rot === 90 ? { ...info, width: v.height, height: v.width } : { ...info, width: v.width, height: v.height };
}

export class FfmpegMedia implements Media {
  async probe(path: string): Promise<MediaInfo> {
    const { stdout } = await run("ffprobe", ["-v", "error", ...SAFE, "-show_entries",
      "format=duration:stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation", "-of", "json", "--", path]);
    return parseProbe(JSON.parse(stdout) as ProbeJson);
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
