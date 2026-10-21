import type { PlayerRef } from "@remotion/player";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { CAPTION_TEMPLATES } from "@shared/captions/templates";
import { mapTime } from "@shared/editing/cuts";
import { enabledCuts } from "@shared/editing/renderProps";
import { FPS } from "@shared/remotion/CaptionVideo";
import type { Action, BrollInput, PlanInput, Project } from "@shared/types";
import { addBroll, applyProjectActions, assetFileUrl, getProject, planProject, runProject, setSource } from "@/features/projects/api/projects";
import { useProjectEvents } from "@/features/projects/hooks/useProjectEvents";
import { BrollPanel, actionErrorNotice } from "./panels/BrollPanel";
import { CaptionPreview } from "./panels/CaptionPreview";
import { EditPlanPanel } from "./panels/EditPlanPanel";
import { PhraseEditor } from "./panels/PhraseEditor";
import { StageProgress } from "./panels/StageProgress";
import { UploadDropzone } from "@/features/projects/components/UploadDropzone";

const RUNNING: Project["status"][] = ["transcribing", "planning", "generating", "rendering"];

export default function EditorPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const events = useProjectEvents(id);
  const refresh = () => qc.invalidateQueries({ queryKey: ["project", id] });
  const source = useMutation({ mutationFn: (assetId: string) => setSource(id, assetId), onSuccess: refresh });
  const run = useMutation({ mutationFn: () => runProject(id), onSuccess: refresh });
  const plan = useMutation({ mutationFn: (input: PlanInput) => planProject(id, input), onSuccess: refresh });
  const broll = useMutation({ mutationFn: (input: BrollInput) => addBroll(id, input), onSuccess: refresh });
  const [notice, setNotice] = useState<string | null>(null);
  const actions = useMutation({
    mutationFn: (a: Action[]) => applyProjectActions(id, { baseVersion: project.data!.updatedAt, actions: a, render: true }),
    onSuccess: () => { setNotice(null); refresh(); },
    // The agent (or another tab) edited first: reload so the next tap starts from its state.
    onError: (e) => { const n = actionErrorNotice(e); if (n) { setNotice(n); refresh(); } },
  });
  const playerRef = useRef<PlayerRef>(null);

  const p = project.data;
  if (!p) return <main className="p-4 text-neutral-300">{project.isError ? "Project not found." : "Loading…"}</main>;
  const mutations = [run, plan, broll, actions];
  const busy = RUNNING.includes(p.status) || mutations.some((m) => m.isPending);
  const failure = events.error ?? mutations.find((m) => m.error && !actionErrorNotice(m.error))?.error?.message ?? (p.status === "failed" ? "see server logs" : null);
  const sourceUrl = p.sourceAssetId ? assetFileUrl(p.sourceAssetId) : null;
  const durationMs = p.sourceDurationMs ?? sourceDuration(p);
  // Plan times are source time; the player runs on the cut timeline.
  const seek = (ms: number) => playerRef.current?.seekTo(Math.round((mapTime(ms, enabledCuts(p)) * FPS) / 1000));
  const download = "min-h-11 content-center rounded-md bg-neutral-800 px-4";

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
              ? <CaptionPreview project={p} videoSrc={sourceUrl} durationMs={durationMs} playerRef={playerRef} />
              : <video src={sourceUrl} controls className="mx-auto max-h-[70vh] w-full rounded-lg bg-black" />}
            <div className="flex flex-wrap gap-2">
              <select className="min-h-11 rounded-md bg-neutral-800 px-3" value={p.captionTemplateId} disabled={busy} onChange={(e) => actions.mutate([{ type: "setTemplate", captionTemplateId: e.target.value as Project["captionTemplateId"] }])}>
                {CAPTION_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="min-h-11 rounded-md bg-white px-4 font-medium text-black disabled:opacity-50" disabled={busy} onClick={() => run.mutate()}>
                {p.status === "ready" ? "Re-run" : "Generate captions"}
              </button>
            </div>
            {busy && <StageProgress kind={events.kind} stage={events.stage} progress={events.progress} />}
            {failure && <p className="text-sm text-red-400">Failed: {failure}</p>}
            {p.warnings.includes("no_speech") && <p className="text-sm text-amber-400">No speech detected in this clip.</p>}
            {p.status === "ready" && (
              <div className="flex flex-wrap gap-2 text-sm">
                {p.outputs.mp4AssetId && <a className={download} href={assetFileUrl(p.outputs.mp4AssetId)} download={`${p.title}.mp4`}>Download MP4</a>}
                {p.outputs.srtAssetId && <a className={download} href={assetFileUrl(p.outputs.srtAssetId)} download={`${p.title}.srt`}>SRT</a>}
                {p.outputs.vttAssetId && <a className={download} href={assetFileUrl(p.outputs.vttAssetId)} download={`${p.title}.vtt`}>VTT</a>}
                {p.outputs.translations?.map((t) => (
                  <Fragment key={t.language}>
                    <a className={download} href={assetFileUrl(t.srtAssetId)} download={`${p.title}.${t.language}.srt`}>SRT ({t.language})</a>
                    <a className={download} href={assetFileUrl(t.vttAssetId)} download={`${p.title}.${t.language}.vtt`}>VTT ({t.language})</a>
                  </Fragment>
                ))}
              </div>
            )}
            {p.transcript && p.phrases.length > 0 && (
              <EditPlanPanel key={p.id} project={p} busy={busy} onPlan={(input) => plan.mutate(input)} onUpdate={(a) => actions.mutate(a)} onSeek={seek} />
            )}
            {p.editPlan && (
              <BrollPanel key={`broll-${p.id}`} project={p} busy={busy} notice={notice} onMediaSource={(m) => actions.mutate([{ type: "setMediaSource", mediaSource: m }])}
                onAdd={(input) => broll.mutate(input)} onActions={(a) => actions.mutate(a)} onSeek={seek} />
            )}
          </section>
          <section>
            {p.phrases.length > 0
              ? <PhraseEditor phrases={p.phrases} busy={busy} onApply={(next) => actions.mutate(textEdits(p.phrases, next))} />
              : <p className="text-sm text-neutral-400">{busy ? "Working…" : "Run the pipeline to generate captions."}</p>}
          </section>
        </div>
      )}
    </main>
  );
}

// Interim (plan 4 Task 2 → Task 8): the phrase editor's result as editPhrase actions; emptied phrases are not deleted.
const textOf = (ph: Project["phrases"][number]) => ph.words.map((w) => w.text).join(" ");
const textEdits = (before: Project["phrases"], after: Project["phrases"]): Action[] =>
  after.flatMap((ph) => (before.some((b) => b.id === ph.id && textOf(b) !== textOf(ph)) ? [{ type: "editPhrase" as const, phraseId: ph.id, text: textOf(ph) }] : []));

// Fallback for projects saved before sourceDurationMs existed: derive it from the last transcript word or phrase.
function sourceDuration(p: Project) {
  const last = p.transcript?.words.at(-1)?.endMs ?? p.phrases.at(-1)?.endMs ?? 0;
  return last > 0 ? last + 500 : 0;
}
