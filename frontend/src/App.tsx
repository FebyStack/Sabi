import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/services/http";
import { ProjectList } from "@/features/projects/components/ProjectList";

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 10_000 });
  return (
    <main className="mx-auto max-w-3xl p-4 text-neutral-100">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Captions Clone</h1>
        <span className="text-xs text-neutral-400">api: {health.isSuccess ? "ok" : health.isError ? "down" : "…"}</span>
      </header>
      <ProjectList />
    </main>
  );
}
