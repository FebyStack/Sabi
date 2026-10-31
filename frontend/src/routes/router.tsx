import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/services/http";
import { ProjectList } from "@/features/projects/components/ProjectList";
import { servicesLine } from "@/hooks/useServices";
import { UsageChip } from "@/features/usage/UsageChip";
import { UsagePage } from "@/features/usage/UsagePage";

function Home() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 10_000 });
  const missing = servicesLine(health.data?.services);
  return (
    <main className="mx-auto max-w-3xl px-4 py-4 text-neutral-100">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Sabi</h1>
        <span className="flex items-center gap-3">
          <UsageChip />
          <span className="text-xs text-neutral-400">api: {health.isSuccess ? "ok" : health.isError ? "down" : "…"}</span>
        </span>
      </header>
      {missing && <p className="-mt-4 mb-4 text-xs text-warn">{missing}</p>}
      <ProjectList />
    </main>
  );
}

// The editor (Player, timeline, panels) is its own chunk; the projects list loads without it.
const EditorPage = lazy(() => import("@/features/editor/EditorPage"));

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/usage", element: <UsagePage /> },
  { path: "/p/:id", element: <Suspense fallback={<main className="p-4 text-ink-muted">Loading…</main>}><EditorPage /></Suspense> },
]);
