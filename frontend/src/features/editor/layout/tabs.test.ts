import { TABS, tabFromSearch, tabLabel, visibleTabs } from "./tabs";

describe("editor tabs", () => {
  it("tabFromSearch defaults and parses", () => {
    expect(tabFromSearch("")).toBe("timeline");
    expect(tabFromSearch("?tab=style")).toBe("style");
    expect(tabFromSearch("?x=1&tab=export")).toBe("export");
    expect(tabFromSearch("?tab=nope")).toBe("timeline");
    expect(TABS.map(tabLabel)).toEqual(["Timeline", "Captions", "B-roll", "Style", "Export"]);
  });

  it("visibleTabs hides the timeline tab on desktop", () => {
    expect(visibleTabs(false)).toEqual(TABS);
    expect(visibleTabs(true)).toEqual(["captions", "broll", "style", "export"]);
  });
});
