import type { PlayerRef } from "@remotion/player";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useMemo, useRef } from "react";
import { Link, useLocation, useParams } from "react-router";
import { mapTime } from "@shared/editing/cuts";
import { enabledCuts } from "@shared/editing/renderProps";
import { FPS } from "@shared/remotion/CaptionVideo";
import type { Action, BrollInput, PlanInput, Project } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { addBroll, assetFileUrl, getProject, planProject, renderProject, runProject, setSource } from "@/features/projects/api/projects";
import { UploadDropzone } from "@/features/projects/components/UploadDropzone";
import { useProjectEvents } from "@/features/projects/hooks/useProjectEvents";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { previewOf } from "./actions/preview";
import { useProjectActions } from "./actions/useProjectActions";
import { EditorLayout } from "./layout/EditorLayout";
import { tabFromSearch } from "./layout/tabs";
import { BrollPanel } from "./panels/BrollPanel";
import { CaptionPreview } from "./panels/CaptionPreview";
import { PlanPanel } from "./panels/PlanPanel";
import { StylePanel } from "./panels/StylePanel";
import { CaptionsPanel } from "./panels/CaptionsPanel";
import { StageProgress } from "./panels/StageProgress";
import { createEditorStore, useEditorStore } from "./store/editorStore";
import { SelectionBar } from "./timeline/SelectionBar";
import { Timeline } from "./timeline/Timeline";
import { mss } from "./timeline/layout";

const RUNNING: Project["status"][] = ["transcribing", "planning", "generating", "rendering"];

export default function EditorPage() {
  const { id = "" } = useParams();
  const tab = tabFromSearch(useLocation().search);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const qc = useQueryClient();
  const store = useMemo(() => createEditorStore(), [id]); // a fresh editor state per project
  const s = useEditorStore(store, (x) => x);
  const project = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const events = useProjectEvents(id);
  const { commit, undo, redo, retry, dismissConflict, pending } = useProjectActions(id, store);
  const refresh = () => qc.invalidateQueries({ queryKey: ["project", id] });
  const source = useMutation({ mutationFn: (assetId: string) => setSource(id, assetId), onSuccess: refresh });
  const run = useMutation({ mutationFn: () => runProject(id), onSuccess: refresh });
  const plan = useMutation({ mutationFn: (input: PlanInput) => planProject(id, input), onSuccess: refresh });
  const broll = useMutation({ mutationFn: (input: BrollInput) => addBroll(id, input), onSuccess: refresh });
  const render = useMutation({ mutationFn: (scale: 1 | 2) => renderProject(id, { scale }), onSuccess: refresh });
  const playerRef = useRef<PlayerRef>(null);
  const p = project.data;
  const shown = useMemo(() => (p ? previewOf(p, s.drag) : undefined), [p, s.drag]); // the Player follows a drag live
  const onFrame = useCallback((frame: number) => store.set({ playheadMs: (frame / FPS) * 1000 }), [store]);

  if (!p || !shown) return <main className="p-4 text-ink-muted">{project.isError ? "Project not found." : "Loading…"}</main>;
  const mutations = [run, plan, broll, render, source];
  const busy = RUNNING.includes(p.status) || pending || mutations.some((m) => m.isPending);
  const failure = events.error ?? mutations.find((m) => m.error)?.error?.message ?? (p.status === "failed" ? "see server logs" : null);
  const sourceUrl = p.sourceAssetId ? assetFileUrl(p.sourceAssetId) : null;
  const durationMs = p.sourceDurationMs ?? sourceDuration(p);
  const cuts = enabledCuts(p);
  // Stored times are source time; the Player runs on the cut timeline.
  const seek = (ms: number) => playerRef.current?.seekTo(Math.round((mapTime(ms, cuts) * FPS) / 1000));
  const edit = (actions: Action[]) => commit(actions);
  const panelTab = desktop && tab === "timeline" ? "captions" : tab;

  if (!sourceUrl) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        <Header p={p} />
        <UploadDropzone projectId={id} onUploaded={(a) => source.mutate(a.id)} />
        {failure && <Notice tone="error">Failed: {failure}</Notice>}
      </main>
    );
  }

  const preview = p.phrases.length > 0 && durationMs > 0
    ? <CaptionPreview project={shown} videoSrc={sourceUrl} durationMs={durationMs} playerRef={playerRef} onFrame={onFrame} />
    : <video src={sourceUrl} controls className="mx-auto max-h-[45vh] w-full rounded-3 bg-black" />;
  const transport = (
    <div className="flex items-center gap-2 py-2">
      <Link to="/" aria-label="All projects" className="grid min-h-11 min-w-11 place-items-center text-ink-muted">←</Link>
      <Button size="sm" aria-label="Play or pause" onClick={() => playerRef.current?.toggle()}>⏯</Button>
      <span className="text-sm tabular-nums text-ink-muted">{mss(s.playheadMs)} / {mss(mapTime(durationMs, cuts))}</span>
      <span className="ml-auto flex gap-1">
        <Button size="sm" aria-label="Undo" disabled={!s.undo.length || busy} onClick={() => void undo()}>↶</Button>
        <Button size="sm" aria-label="Redo" disabled={!s.redo.length || busy} onClick={() => void redo()}>↷</Button>
      </span>
    </div>
  );
  const banner = (
    <div className="space-y-2">
      <Header p={p} />
      {s.conflict && <Notice tone="warn" action={{ label: "Retry", onClick: () => void retry() }}>{s.conflict.message} <button type="button" className="ml-2 underline" onClick={dismissConflict}>Dismiss</button></Notice>}
      {s.notice && <Notice tone="info">{s.notice}</Notice>}
      {failure && <Notice tone="error">Failed: {failure}</Notice>}
      {p.warnings.includes("no_speech") && <Notice tone="warn">No speech detected in this clip.</Notice>}
      {busy && events.kind && <StageProgress kind={events.kind} stage={events.stage} progress={events.progress} />}
      {s.selection && <SelectionBar project={p} selected={s.selection} commit={edit} onAdd={(input) => broll.mutate(input)} />}
    </div>
  );
  const download = "grid min-h-11 place-items-center rounded-2 bg-surface-2 px-4";
  const panels: Record<typeof panelTab, React.ReactNode> = {
    timeline: !s.selection && <p className="text-sm text-ink-muted">Tap a block to edit it; drag its edges to trim; pinch to zoom.</p>,
    captions: <CaptionsPanel project={p} store={store} commit={edit} busy={busy} onGenerate={() => run.mutate()} />,
    broll: (
      <div className="space-y-6">
        {p.transcript && p.phrases.length > 0 && <PlanPanel key={p.id} project={p} busy={busy} onPlan={(input) => plan.mutate(input)} commit={edit} onSeek={seek} />}
        <BrollPanel key={`broll-${p.id}`} project={p} busy={busy} onAdd={(input) => broll.mutate(input)} commit={edit} onSeek={seek} />
      </div>
    ),
    style: <StylePanel project={p} commit={edit} busy={busy} />,
    export: (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy || !p.phrases.length} onClick={() => render.mutate(1)}>Render</Button>
          <Button disabled={busy} onClick={() => run.mutate()}>Re-run captions</Button>
        </div>
        {p.outputs.mp4AssetId && (
          <div className="flex flex-wrap gap-2 text-sm">
            <a className={download} href={assetFileUrl(p.outputs.mp4AssetId)} download={`${p.title}.mp4`}>Download MP4</a>
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
      </div>
    ),
  };

  return (
    <EditorLayout tab={panelTab} onTab={() => {}} preview={preview} transport={transport} banner={banner} panel={panels[panelTab]}
      timeline={<Timeline project={p} store={store} commit={edit} onPlay={() => playerRef.current?.toggle()} onSeek={seek} onGenerate={() => run.mutate()} />} />
  );
}

function Header({ p }: { p: Project }) {
  return (
    <header className="flex items-center gap-3">
      <h1 className="truncate text-lg font-semibold">{p.title}</h1>
      <span className="ml-auto text-xs text-ink-muted">{p.status}</span>
    </header>
  );
}

// Fallback for projects saved before sourceDurationMs existed: derive it from the last transcript word or phrase.
function sourceDuration(p: Project) {
  const last = p.transcript?.words.at(-1)?.endMs ?? p.phrases.at(-1)?.endMs ?? 0;
  return last > 0 ? last + 500 : 0;
}
