import type { ReactNode } from "react";
import { Link } from "react-router";
import { TABS, tabLabel, type Tab } from "./tabs";

type Props = { preview: ReactNode; transport: ReactNode; timeline: ReactNode; panel: ReactNode; banner: ReactNode; tab: Tab; onTab: (tab: Tab) => void };

// < 1024 px: one column — sticky preview, the timeline (Timeline tab), banner + panel — and a bottom tab bar.
// ≥ 1024 px: preview + transport | tab strip + panel, the timeline always visible full width below.
export function EditorLayout({ preview, transport, timeline, panel, banner, tab, onTab }: Props) {
  return (
    <div className="min-h-dvh bg-surface-0 pb-[calc(56px+env(safe-area-inset-bottom))] text-ink lg:grid lg:grid-cols-[minmax(320px,38%)_1fr] lg:gap-4 lg:p-4 lg:pb-4">
      <section className="sticky top-0 z-10 bg-surface-0 px-4 pt-2 lg:static lg:col-start-1 lg:row-start-1 lg:px-0 lg:pt-0">
        <div className="mx-auto max-h-[45vh] overflow-hidden lg:max-h-none">{preview}</div>
        {transport}
      </section>
      {/* Right under the preview on phones, so a selection bar opening below never moves the block under the finger. */}
      <section className={`px-4 lg:col-span-2 lg:row-start-2 lg:block lg:px-0 ${tab === "timeline" ? "" : "hidden"}`}>{timeline}</section>
      <section className="min-w-0 space-y-3 px-4 py-3 lg:col-start-2 lg:row-start-1 lg:px-0 lg:py-0">
        <nav aria-label="Editor sections"
          className="fixed inset-x-0 bottom-0 z-20 grid h-[calc(56px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] lg:static lg:h-auto lg:grid-cols-4 lg:rounded-2 lg:border-0 lg:pb-0">
          {TABS.map((t) => (
            <Link key={t} to={`?tab=${t}`} aria-current={t === tab ? "page" : undefined} onClick={() => onTab(t)}
              className={`grid min-h-11 place-items-center text-xs ${t === "timeline" ? "lg:hidden" : ""} ${t === tab ? "text-accent" : "text-ink-muted"}`}>
              {tabLabel(t)}
            </Link>
          ))}
        </nav>
        {banner}
        {panel}
      </section>
    </div>
  );
}
