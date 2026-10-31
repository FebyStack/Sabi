import { execFile } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Uploaded files are untrusted: a crafted playlist could make ffmpeg read local files or URLs. Lock protocols and demuxers,
// and probe each file only with the demuxers of the kind it claims to be, so an "image" can never be read as a container.
export type ProbeKind = "image" | "av";
const FORMATS: Record<ProbeKind, string> = { av: "mov,mp4,m4a,3gp,3g2,mj2,mp3,wav", image: "image2,png_pipe,jpeg_pipe,webp_pipe" };
const safe = (kind: ProbeKind) => ["-protocol_whitelist", "file", "-format_whitelist", FORMATS[kind]];
export const MAX_IMAGE_PX = 8192; // Chrome decodes every image layer at full size

export interface MediaInfo { durationMs: number; width?: number; height?: number }

export interface Media {
  probe(path: string, kind?: ProbeKind): Promise<MediaInfo>; // kind defaults to "av"
  extractAudio(input: string, outWav: string): Promise<void>; // 16 kHz mono PCM for the transcriber
  sanitize(input: string, output: string, kind: ProbeKind): Promise<void>; // same format, no EXIF/GPS/location (spec row 2)
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
  async probe(path: string, kind: ProbeKind = "av"): Promise<MediaInfo> {
    const { stdout } = await run("ffprobe", ["-v", "error", ...safe(kind), "-show_entries",
      "format=duration:stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation", "-of", "json", "--", path]);
    return parseProbe(JSON.parse(stdout) as ProbeJson);
  }
  async extractAudio(input: string, outWav: string) {
    await run("ffmpeg", ["-y", "-v", "error", ...safe("av"), "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outWav]);
  }
  // Images: sharp turns the pixels upright from the EXIF orientation and writes no metadata (EXIF, GPS, XMP) unless asked.
  // Audio/video: a stream copy (no re-encode) without global/stream metadata, chapters or cover art; rotation is side data and stays.
  // MP4/MOV get their index (moov) ahead of the media, so a browser or the render starts playing before the whole file arrives.
  async sanitize(input: string, output: string, kind: ProbeKind) {
    const ext = extname(output).toLowerCase();
    if (kind === "image") {
      const { default: sharp } = await import("sharp");
      const img = sharp(input, { limitInputPixels: MAX_IMAGE_PX ** 2 }).rotate();
      await (ext === ".png" ? img.png() : ext === ".webp" ? img.webp({ quality: 92 }) : img.jpeg({ quality: 92 })).toFile(output);
      return;
    }
    const faststart = ext === ".mp4" || ext === ".mov" ? ["-movflags", "+faststart"] : [];
    await run("ffmpeg", ["-v", "error", "-y", ...safe("av"), "-i", input, "-map", "0:V?", "-map", "0:a?", "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy", ...faststart, output]);
  }
}

export class FakeMedia implements Media {
  constructor(private info: MediaInfo) {}
  async probe() { return this.info; }
  async extractAudio(_input: string, _outWav: string) {}
  async sanitize(input: string, output: string, _kind: ProbeKind) { await copyFile(input, output); }
}
