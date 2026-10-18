import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { segmentCaptions } from "../../../shared/captions/segment";
import { toSrt, toVtt } from "../../../shared/captions/subtitles";
import { getCaptionTemplate } from "../../../shared/captions/templates";
import { api } from "../../../shared/contract";
import type { Asset, JobState, Project, ProjectStatus } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";

export type RunOptions = { language?: string; transcribe: boolean; resegment: boolean };

const DIMS = { "9:16": { width: 1080, height: 1920 }, "16:9": { width: 1920, height: 1080 } } as const;

// One job: extract-audio → transcribe → segment → render → subtitles. Status: transcribing → rendering → ready | failed.
export function startCaptionJob(deps: AppDeps, project: Project, opts: RunOptions): JobState {
  return deps.jobs.enqueue(project.id, "captions", async ({ report }) => {
    const setStatus = async (status: ProjectStatus, patch: Partial<Project> = {}) => {
      await deps.projects.update(project.id, { status, ...patch });
      deps.bus.publish(project.id, { type: "project", status });
    };
    try {
      const source = await deps.assets.get(project.sourceAssetId!);
      if (!source) throw new Error("no_source");
      let transcript = project.transcript;
      let phrases = project.phrases;
      const template = getCaptionTemplate(project.captionTemplateId);

      if (opts.transcribe) {
        await setStatus("transcribing");
        report(10, "extract-audio");
        const wav = deps.storage.localPath(`work/${project.id}/audio.wav`);
        await mkdir(dirname(wav), { recursive: true });
        await deps.media.extractAudio(deps.storage.localPath(source.key), wav);
        report(40, "transcribe");
        transcript = await deps.transcriber.transcribe(wav, { language: opts.language ?? project.language ?? undefined });
      }
      if (opts.transcribe || opts.resegment) {
        report(60, "segment");
        // A template change re-flows the user's edited words (spelling fixes survive); a fresh transcription starts from the ASR words.
        const words = !opts.transcribe && phrases.length ? phrases.flatMap((p) => p.words) : transcript?.words ?? [];
        phrases = segmentCaptions(words, template.layout);
      }
      const warnings = transcript && transcript.words.length === 0 ? ["no_speech"] : [];
      await setStatus("rendering", { transcript, phrases, language: transcript?.language ?? project.language, warnings });

      report(70, "render");
      const { width, height } = DIMS[project.aspectRatio];
      const durationMs = source.durationMs ?? 0;
      const jobKey = `renders/${project.id}/${deps.id()}`;
      const outPath = deps.storage.localPath(`${jobKey}.mp4`);
      await mkdir(dirname(outPath), { recursive: true });
      await deps.renderer.render({
        compositionId: "CaptionVideo",
        inputProps: { videoSrc: `${deps.apiBaseUrl}${api.assetFile(source.id)}`, sourceKind: source.kind === "audio" ? "audio" : "video", phrases, template, width, height, durationMs },
        durationMs,
        outPath,
      });
      const mp4 = await addAsset(deps, project.id, "render", `${jobKey}.mp4`, "video/mp4", { width, height, durationMs });

      report(95, "subtitles");
      await deps.storage.write(`${jobKey}.srt`, Buffer.from(toSrt(phrases)));
      await deps.storage.write(`${jobKey}.vtt`, Buffer.from(toVtt(phrases)));
      const srt = await addAsset(deps, project.id, "subtitle", `${jobKey}.srt`, "text/plain");
      const vtt = await addAsset(deps, project.id, "subtitle", `${jobKey}.vtt`, "text/vtt");

      await setStatus("ready", { outputs: { mp4AssetId: mp4.id, srtAssetId: srt.id, vttAssetId: vtt.id } });
      report(100);
    } catch (err) {
      await setStatus("failed");
      throw err;
    }
  });
}

async function addAsset(deps: AppDeps, projectId: string, kind: Asset["kind"], key: string, mimeType: string, extra: Partial<Asset> = {}) {
  const stored = await deps.storage.stat(key);
  return deps.assets.create({ id: deps.id(), projectId, kind, key, mimeType, sizeBytes: stored?.size ?? 0, createdAt: deps.now().toISOString(), ...extra });
}
