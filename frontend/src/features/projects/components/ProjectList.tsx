import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Project } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Link, useNavigate } from "react-router";
import { track } from "@/features/consent/analytics";
import { STAGE_LABELS, stageView } from "@/features/editor/panels/progressModel";
import { createProject, listProjects } from "@/services/http";
import { deleteProject } from "../api/projects";

export function ProjectList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const create = useMutation({
    mutationFn: createProject,
    onSuccess: (p) => { track("project_created"); qc.invalidateQueries({ queryKey: ["projects"] }); navigate(`/p/${p.id}`); },
  });
  const [title, setTitle] = useState("");
  const [doomed, setDoomed] = useState<Project | null>(null);
  const remove = useMutation({ mutationFn: deleteProject, onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }) });

  return (
    <section className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (title.trim()) { create.mutate({ title: title.trim(), aspectRatio: "9:16", mediaSource: "generate" }); setTitle(""); } }}
      >
        <input className="min-h-11 flex-1 rounded-md bg-neutral-800 px-3" placeholder="New project title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="min-h-11 rounded-md bg-white px-4 font-medium text-black disabled:opacity-50" disabled={create.isPending}>Create</button>
      </form>
      {projects.data?.length === 0 && <p className="text-ink-muted">No projects yet — Create one above to start.</p>}
      {remove.error && <p role="status" className="text-sm text-danger">Delete failed: {remove.error.message === "busy" ? "a job is running" : remove.error.message}</p>}
      <ul className="divide-y divide-line">
        {projects.data?.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <Link to={`/p/${p.id}`} className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 py-2 hover:text-white">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{p.title}</span>
                {p.demo && <span className="shrink-0 rounded-1 bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-ink">Demo</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-muted">{p.aspectRatio} · {p.mediaSource} · {statusLabel(p.status)}</span>
            </Link>
            <Button size="sm" variant="ghost" aria-label={`Delete ${p.title}`} aria-haspopup="dialog" onClick={() => setDoomed(p)}>✕</Button>
          </li>
        ))}
      </ul>
      <Sheet open={!!doomed} onClose={() => setDoomed(null)} title={`Delete “${doomed?.title ?? ""}”?`}>
        <p className="mb-4 text-sm text-ink-muted">Its upload, B-roll, renders and subtitles are deleted too. This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => { if (doomed) remove.mutate(doomed.id); setDoomed(null); }}>Delete</Button>
          <Button onClick={() => setDoomed(null)}>Cancel</Button>
        </div>
      </Sheet>
    </section>
  );
}

// Running statuses read as the editor's stepper does ("Planning the edit"); others as stored.
const statusLabel = (status: Parameters<typeof stageView>[0]["status"]) => {
  const v = stageView({ uploadPct: null, kind: null, stage: null, progress: 0, status });
  return v ? STAGE_LABELS[v.stage] : status;
};
