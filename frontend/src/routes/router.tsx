import { createBrowserRouter } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/services/http";
import { ProjectList } from "@/features/projects/components/ProjectList";
import { ProjectPage } from "@/features/projects/components/ProjectPage";

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

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/p/:id", element: <ProjectPage /> },
]);
