import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { EditorLayout } from "./EditorLayout";

const layout = (tab: Parameters<typeof EditorLayout>[0]["tab"]) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/p/A?tab=${tab}`]}>
    <EditorLayout tab={tab} onTab={() => {}} preview={<p>PREVIEW</p>} transport={<p>TRANSPORT</p>} timeline={<p>TIMELINE</p>} panel={<p>PANEL</p>} banner={<p>BANNER</p>} />
  </MemoryRouter>,
);

describe("EditorLayout", () => {
  it("renders five tab links with the current one marked", () => {
    const html = layout("captions");
    expect(html).toContain('<nav aria-label="Editor sections"');
    const links = html.match(/<a [^>]*href="[^"]*\?tab=[a-z]+"[^>]*>/g) ?? [];
    expect(links).toHaveLength(5);
    expect(links.filter((l) => l.includes('aria-current="page"'))).toEqual([expect.stringContaining("?tab=captions")]);
    for (const part of ["PREVIEW", "TRANSPORT", "TIMELINE", "PANEL", "BANNER"]) expect(html).toContain(part);
  });
});
