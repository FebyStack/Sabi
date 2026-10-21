export const TABS = ["timeline", "captions", "broll", "style", "export"] as const;
export type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = { timeline: "Timeline", captions: "Captions", broll: "B-roll", style: "Style", export: "Export" };

export const tabFromSearch = (search: string): Tab => {
  const t = new URLSearchParams(search).get("tab");
  return (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "timeline";
};
export const tabLabel = (tab: Tab) => LABELS[tab];
// Desktop shows the timeline full width under the preview, so it needs no tab.
export const visibleTabs = (desktop: boolean): readonly Tab[] => (desktop ? TABS.filter((t) => t !== "timeline") : TABS);
