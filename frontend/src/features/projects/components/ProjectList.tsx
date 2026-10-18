import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createProject, listProjects } from "@/services/http";

export function ProjectList() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const create = useMutation({ mutationFn: createProject, onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }) });
  const [title, setTitle] = useState("");

  return (
    <section className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (title.trim()) { create.mutate({ title: title.trim(), aspectRatio: "9:16", mediaSource: "generate" }); setTitle(""); } }}
      >
        <input className="min-h-11 flex-1 rounded-md bg-neutral-800 px-3" placeholder="New project title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="min-h-11 rounded-md bg-white px-4 font-medium text-black disabled:opacity-50" disabled={create.isPending}>Create</button>
      </form>
      {projects.data?.length === 0 && <p className="text-neutral-400">No projects yet — create one to start.</p>}
      <ul className="divide-y divide-neutral-800">
        {projects.data?.map((p) => (
          <li key={p.id} className="flex min-h-11 items-center justify-between py-2">
            <span>{p.title}</span>
            <span className="text-xs text-neutral-400">{p.aspectRatio} · {p.mediaSource} · {p.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
