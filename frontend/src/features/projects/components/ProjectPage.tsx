import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { CAPTION_TEMPLATES } from "@shared/captions/templates";
import type { Project } from "@shared/types";
import { assetFileUrl, getProject, runProject, setSource, updatePhrases, updateTemplate } from "../api/projects";
import { useProjectEvents } from "../hooks/useProjectEvents";
import { CaptionPreview } from "./CaptionPreview";
import { PhraseEditor } from "./PhraseEditor";
import { StageProgress } from "./StageProgress";
import { UploadDropzone } from "./UploadDropzone";

const RUNNING: Project["status"][] = ["transcribing", "planning", "generating", "rendering"];

export function ProjectPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const events = useProjectEvents(id);
  const refresh = () => qc.invalidateQueries({ queryKey: ["project", id] });
  const source = useMutation({ mutationFn: (assetId: string) => setSource(id, assetId), onSuccess: refresh });
  const run = useMutation({ mutationFn: () => runProject(id), onSuccess: refresh });
  const phrases = useMutation({ mutationFn: (p: Project["phrases"]) => updatePhrases(id, p), onSuccess: refresh });
  const template = useMutation({ mutationFn: (t: Project["captionTemplateId"]) => updateTemplate(id, t), onSuccess: refresh });

  const p = project.data;
  if (!p) return <main className="p-4 text-neutral-300">{project.isError ? "Project not found." : "Loading…"}</main>;
  const busy = RUNNING.includes(p.status) || run.isPending || phrases.isPending || template.isPending;
  const sourceUrl = p.sourceAssetId ? assetFileUrl(p.sourceAssetId) : null;
  const durationMs = sourceDuration(p);

  return (
    <main className="mx-auto max-w-5xl px-4 py-4 text-neutral-100">
      <header className="mb-4 flex items-center gap-3">
        <Link to="/" className="min-h-11 min-w-11 content-center text-neutral-400">←</Link>
        <h1 className="truncate text-lg font-semibold">{p.title}</h1>
        <span className="ml-auto text-xs text-neutral-400">{p.status}</span>
      </header>

      {!sourceUrl && <UploadDropzone projectId={id} onUploaded={(a) => source.mutate(a.id)} />}

      {sourceUrl && (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-3">
            {p.phrases.length > 0 && durationMs > 0
              ? <CaptionPreview project={p} videoSrc={sourceUrl} durationMs={durationMs} />
              : <video src={sourceUrl} controls className="mx-auto max-h-[70vh] w-full rounded-lg bg-black" />}
            <div className="flex flex-wrap gap-2">
              <select className="min-h-11 rounded-md bg-neutral-800 px-3" value={p.captionTemplateId} disabled={busy} onChange={(e) => template.mutate(e.target.value as Project["captionTemplateId"])}>
                {CAPTION_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="min-h-11 rounded-md bg-white px-4 font-medium text-black disabled:opacity-50" disabled={busy} onClick={() => run.mutate()}>
                {p.status === "ready" ? "Re-run" : "Generate captions"}
              </button>
            </div>
            {busy && <StageProgress stage={events.stage} progress={events.progress} />}
            {(events.error || p.status === "failed") && <p className="text-sm text-red-400">Failed: {events.error ?? "see server logs"}</p>}
            {p.warnings.includes("no_speech") && <p className="text-sm text-amber-400">No speech detected in this clip.</p>}
            {p.status === "ready" && (
              <div className="flex flex-wrap gap-2 text-sm">
                {p.outputs.mp4AssetId && <a className="min-h-11 content-center rounded-md bg-neutral-800 px-4" href={assetFileUrl(p.outputs.mp4AssetId)} download={`${p.title}.mp4`}>Download MP4</a>}
                {p.outputs.srtAssetId && <a className="min-h-11 content-center rounded-md bg-neutral-800 px-4" href={assetFileUrl(p.outputs.srtAssetId)} download={`${p.title}.srt`}>SRT</a>}
                {p.outputs.vttAssetId && <a className="min-h-11 content-center rounded-md bg-neutral-800 px-4" href={assetFileUrl(p.outputs.vttAssetId)} download={`${p.title}.vtt`}>VTT</a>}
              </div>
            )}
          </section>
          <section>
            {p.phrases.length > 0
              ? <PhraseEditor phrases={p.phrases} busy={busy} onApply={(next) => phrases.mutate(next)} />
              : <p className="text-sm text-neutral-400">{busy ? "Working…" : "Run the pipeline to generate captions."}</p>}
          </section>
        </div>
      )}
    </main>
  );
}

// The source asset's duration isn't on the project; derive it from the last phrase or transcript word until plan 2 adds assets to the payload.
function sourceDuration(p: Project) {
  const last = p.transcript?.words.at(-1)?.endMs ?? p.phrases.at(-1)?.endMs ?? 0;
  return last > 0 ? last + 500 : 0;
}
