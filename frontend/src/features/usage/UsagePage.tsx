import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Notice } from "@/components/ui/Notice";
import { getUsage, spendText, usd } from "./api";

// Months are UTC, as the server counts them against the cap.
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

// Paid generations (fal.ai) by month: the ledger outlives deleted projects, so their rows say so.
export function UsagePage() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: getUsage });
  const u = usage.data;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-4 text-ink">
      <header className="flex items-center gap-2">
        <Link to="/" aria-label="All projects" className="grid min-h-11 min-w-11 place-items-center text-ink-muted">←</Link>
        <h1 className="text-xl font-semibold">Usage</h1>
      </header>
      {usage.isError && <Notice tone="error">Couldn't load usage: {usage.error.message}</Notice>}
      {!u ? !usage.isError && <p className="text-ink-muted">Loading…</p> : (
        <>
          <p className="text-sm text-ink-muted">{`${spendText(u.monthCents, u.capCents)} · fal.ai generations only; Pexels stock is free.`}</p>
          {u.months.length === 0 ? <p className="text-ink-muted">No paid generations yet — stock B-roll is free</p> : u.months.map((m) => (
            <section key={m.month} className="space-y-2">
              <h2 className="text-sm font-medium text-ink-muted">{`${monthName(m.month)} · ${usd(m.totalCents)}`}</h2>
              <ul className="divide-y divide-line rounded-3 bg-surface-1">
                {m.rows.map((r) => (
                  <li key={r.id} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-14 shrink-0 tabular-nums text-ink-muted">{day(r.createdAt)}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{`${r.media === "video" ? "Video" : "Image"} · ${r.model.split("/")[1] ?? r.model}`}</span>
                      {r.projectTitle && r.projectId
                        ? <Link to={`/p/${r.projectId}`} className="truncate text-xs text-ink-muted underline">{r.projectTitle}</Link>
                        : <span className="text-xs text-ink-muted">Deleted project</span>}
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{r.actor}</span>
                    <span className="w-14 shrink-0 text-right tabular-nums">{usd(r.costCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
