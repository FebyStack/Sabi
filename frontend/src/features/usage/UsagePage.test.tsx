import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { Usage } from "@shared/types";
import { UsageChip } from "./UsageChip";
import { UsagePage } from "./UsagePage";

const render = (node: ReactNode, usage?: Usage) => {
  const qc = new QueryClient();
  if (usage) qc.setQueryData(["usage"], usage);
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
};
const usage: Usage = {
  capCents: 2000, monthCents: 26,
  months: [
    { month: "2026-10", totalCents: 26, rows: [
      { id: "r1", createdAt: "2026-10-22T09:00:00.000Z", model: "fal-ai/kling-video/v1.6/standard/image-to-video", media: "video", costCents: 25, jobKind: "generate", actor: "agent", projectId: "p1", projectTitle: "Morning routine" },
      { id: "r2", createdAt: "2026-10-21T09:00:00.000Z", model: "fal-ai/flux/schnell", media: "image", costCents: 1, jobKind: "broll", actor: "web", projectId: "gone", projectTitle: null },
    ] },
    { month: "2026-09", totalCents: 1, rows: [
      { id: "r3", createdAt: "2026-09-02T09:00:00.000Z", model: "fal-ai/flux/schnell", media: "image", costCents: 1, jobKind: "broll", actor: "web", projectId: "p1", projectTitle: "Morning routine" },
    ] },
  ],
};

describe("UsagePage", () => {
  it("shows months, totals and rows", () => {
    const html = render(<UsagePage />, usage);
    expect(html).toMatch(/<h2[^>]*>October 2026 · \$0\.26<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>September 2026 · \$0\.01<\/h2>/);
    expect(html).toContain("Video · kling-video");
    expect(html).toContain("Image · flux");
    expect(html).toContain("$0.25");
    expect(html).toContain("agent");
    expect(html).toContain('href="/p/p1"');
    expect(html).toContain("Deleted project");
    expect(html).toContain("This month $0.26 of $20.00");
  });

  it("empty state", () => {
    expect(render(<UsagePage />, { capCents: 2000, monthCents: 0, months: [] })).toContain("No paid generations yet — stock B-roll is free");
  });

  it("UsageChip shows the month against the cap, or alone when there is none", () => {
    expect(render(<UsageChip />, usage)).toMatch(/<a[^>]*href="\/usage"[^>]*>This month \$0\.26 of \$20\.00<\/a>/);
    expect(render(<UsageChip />, { ...usage, capCents: 0 })).toContain(">This month $0.26</a>");
    expect(render(<UsageChip />)).toBe(""); // nothing until it loads
  });
});
