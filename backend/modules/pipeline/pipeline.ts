import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { carryEmoji, segmentCaptions } from "../../../shared/captions/segment";
import { toSrt, toVtt } from "../../../shared/captions/subtitles";
import { getCaptionTemplate } from "../../../shared/captions/templates";
import { api } from "../../../shared/contract";
import { captionVideoProps, subtitleTracks } from "../../../shared/editing/renderProps";
import type { Asset, JobState, Project, ProjectStatus } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";

export type RunOptions = { language?: string; transcribe: boolean; resegment: boolean; scale?: 1 | 2 };

// One job: extract-audio → transcribe → segment → render → subtitles. Status: transcribing → rendering → ready | failed.
export function startCaptionJob(deps: AppDeps, project: Project, opts: RunOptions): JobState {
  return deps.jobs.enqueue(project.id, "captions", async ({ report }) => {
    const setStatus = async (status: ProjectStatus, patch: Partial<Project> = {}) => {
      const updated = await deps.projects.update(project.id, { status, ...patch });
      deps.bus.publish(project.id, { type: "project", status });
      return updated;
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
        phrases = segmentCaptions(words, template.layout, transcript?.language ?? project.language);
        if (!opts.transcribe) phrases = carryEmoji(project.phrases, phrases);
      }
      const warnings = [
        ...(transcript && transcript.words.length === 0 ? ["no_speech"] : []),
        ...((transcript?.estimatedWords ?? 0) > 0 ? ["timing_estimated"] : []),
      ];
      // A new transcript invalidates the plan (cuts, shots, translations all refer to the old words) and the B-roll placed on its shots.
      // Motion graphics and the brand kit are the agent's own work and stay.
      const cleared = opts.transcribe ? { editPlan: null, translations: [], burnInLanguage: null, overlays: [] } : {};
      const current = await setStatus("rendering", { transcript, phrases, language: transcript?.language ?? project.language, warnings, ...cleared });
      await setStatus("ready", { outputs: await renderOutputs(deps, current, source, report, opts.scale) });
      report(100);
    } catch (err) {
      await setStatus("failed");
      throw err;
    }
  });
}

// Render the MP4 and every subtitle track (original + translations) on the cut timeline; fresh outputs are never stale.
// Without a scale, a job keeps the project's last export resolution.
export async function renderOutputs(deps: AppDeps, project: Project, source: Asset, report: (p: number, stage?: string) => void,
  scale: 1 | 2 = project.outputs.resolution === "4k" ? 2 : 1): Promise<Project["outputs"]> {
  report(70, "render");
  const props = captionVideoProps(project, { videoSrc: `${deps.apiBaseUrl}${api.assetFile(source.id)}`, sourceDurationMs: source.durationMs ?? 0, assetUrl: (id) => `${deps.apiBaseUrl}${api.assetFile(id)}` });
  const jobKey = `renders/${project.id}/${deps.id()}`;
  const outPath = deps.storage.localPath(`${jobKey}.mp4`);
  await mkdir(dirname(outPath), { recursive: true });
  await deps.renderer.render({ compositionId: "CaptionVideo", inputProps: props, durationMs: props.durationMs, outPath, scale });
  const mp4 = await addAsset(deps, project.id, "render", `${jobKey}.mp4`, "video/mp4", { width: props.width * scale, height: props.height * scale, durationMs: props.durationMs });

  report(95, "subtitles");
  const translations: NonNullable<Project["outputs"]["translations"]> = [];
  const outputs: Project["outputs"] = { mp4AssetId: mp4.id, translations, resolution: scale === 2 ? "4k" : "1080p" };
  for (const { language, phrases } of subtitleTracks(project)) {
    const key = language ? `${jobKey}.${language}` : jobKey;
    await deps.storage.write(`${key}.srt`, Buffer.from(toSrt(phrases)));
    await deps.storage.write(`${key}.vtt`, Buffer.from(toVtt(phrases)));
    const srt = await addAsset(deps, project.id, "subtitle", `${key}.srt`, "text/plain");
    const vtt = await addAsset(deps, project.id, "subtitle", `${key}.vtt`, "text/vtt");
    if (language) translations.push({ language, srtAssetId: srt.id, vttAssetId: vtt.id });
    else { outputs.srtAssetId = srt.id; outputs.vttAssetId = vtt.id; }
  }
  return outputs;
}

async function addAsset(deps: AppDeps, projectId: string, kind: Asset["kind"], key: string, mimeType: string, extra: Partial<Asset> = {}) {
  const stored = await deps.storage.stat(key);
  return deps.assets.create({ id: deps.id(), projectId, kind, key, mimeType, sizeBytes: stored?.size ?? 0, createdAt: deps.now().toISOString(), ...extra });
}
