import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/services/http";
import { ProjectList } from "@/features/projects/components/ProjectList";

function Home() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 10_000 });
  return (
    <main className="mx-auto max-w-3xl px-4 py-4 text-neutral-100">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Sabi</h1>
        <span className="text-xs text-neutral-400">api: {health.isSuccess ? "ok" : health.isError ? "down" : "…"}</span>
      </header>
      <ProjectList />
    </main>
  );
}

// The editor (Player, timeline, panels) is its own chunk; the projects list loads without it.
const EditorPage = lazy(() => import("@/features/editor/EditorPage"));

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/p/:id", element: <Suspense fallback={<main className="p-4 text-ink-muted">Loading…</main>}><EditorPage /></Suspense> },
]);
