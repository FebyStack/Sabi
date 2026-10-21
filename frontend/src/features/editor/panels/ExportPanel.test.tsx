import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Project } from "@shared/types";
import { ExportPanel } from "./ExportPanel";

const panel = (p: Project) => renderToStaticMarkup(<ExportPanel project={p} busy={false} onRender={() => {}} onDownload={() => {}} />);

describe("ExportPanel", () => {
  it("shows the stale notice", () => {
    expect(panel(editorProject({ outputs: { ...editorProject().outputs, stale: true } }))).toContain("Edits since the last render — render again to export them");
    expect(panel(editorProject())).not.toContain("Edits since the last render");
  });

  it("resolution reflects the last render", () => {
    expect(panel(editorProject({ outputs: { ...editorProject().outputs, resolution: "4k" } }))).toMatch(/role="radio" aria-checked="true"[^>]*>4K</);
    const html = panel(editorProject({ outputs: { ...editorProject().outputs, resolution: "4k" } }));
    expect(html).toContain("Rendered at 4K");
    expect(panel(editorProject())).toMatch(/role="radio" aria-checked="true"[^>]*>1080p</);
  });

  it("download links carry the title", () => {
    const html = panel(editorProject({ outputs: { ...editorProject().outputs, translations: [{ language: "es", srtAssetId: "es-srt", vttAssetId: "es-vtt" }] } }));
    expect(html).toContain('download="Morning.mp4"');
    expect(html).toContain('download="Morning.srt"');
    expect(html).toContain('download="Morning.vtt"');
    expect(html).toContain('download="Morning.es.srt"');
    expect(html).toContain('href="/api/assets/mp4/file"');
  });

  it("empty state without outputs", () => {
    const html = panel(editorProject({ outputs: {} }));
    expect(html).toContain("Render to create the MP4 and subtitles");
    expect(html).not.toContain("download=");
    expect(panel(editorProject({ phrases: [] }))).toMatch(/<button[^>]*disabled=""[^>]*>Render</);
  });
});
