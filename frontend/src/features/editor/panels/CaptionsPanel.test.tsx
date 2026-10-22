import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Project } from "@shared/types";
import { createEditorStore, type Selected } from "../store/editorStore";
import { CaptionsPanel, keepDrafts, nextEmphasis, phraseEdits } from "./CaptionsPanel";

const panel = (project: Project, selection: Selected | null = null) =>
  renderToStaticMarkup(<CaptionsPanel project={project} store={createEditorStore({ selection })} commit={async () => {}} busy={false} onGenerate={() => {}} />);

describe("CaptionsPanel", () => {
  it("phraseEdits emits one editPhrase per changed phrase and ignores emptied text", () => {
    const p = editorProject();
    expect(phraseEdits(p.phrases, { "ph-0": "Morning routines", "ph-1": "  that   sticks ", "ph-2": "   " }))
      .toEqual([{ type: "editPhrase", phraseId: "ph-1", text: "that sticks" }]);
    expect(phraseEdits(p.phrases, {})).toEqual([]);
  });

  it("a highlight or emoji change keeps unsaved text drafts; a saved text change drops only its own", () => {
    const prev = editorProject().phrases;
    const drafts = { "ph-0": "Evening routines", "ph-1": "that sticks" };
    const emphasised = prev.map((p, i) => (i ? p : { ...p, words: [{ ...p.words[0], emphasis: "noun" as const }, p.words[1]], emoji: "🛏️" }));
    expect(keepDrafts(prev, emphasised, drafts)).toEqual(drafts);
    const edited = prev.map((p, i) => (i === 1 ? { ...p, words: [{ ...p.words[0], text: "this" }, p.words[1]] } : p));
    expect(keepDrafts(prev, edited, drafts)).toEqual({ "ph-0": "Evening routines" });
    expect(keepDrafts(prev, prev.slice(1), drafts)).toEqual({ "ph-1": "that sticks" });
  });

  it("word chips expose the emphasis state", () => {
    const html = panel(editorProject({ phrases: editorProject().phrases.map((ph, i) => (i ? ph : { ...ph, words: [{ ...ph.words[0], emphasis: "keyword" as const }, ph.words[1]] })) }));
    expect(html).toMatch(/<button[^>]*aria-label="Morning: keyword"[^>]*aria-pressed="true"|<button[^>]*aria-pressed="true"[^>]*aria-label="Morning: keyword"/);
    expect(html).toMatch(/aria-label="routines: none"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="routines: none"/);
    expect([undefined, "keyword", "noun", "pictorial"].map((e) => nextEmphasis(e as never))).toEqual(["keyword", "noun", "pictorial", null]);
  });

  it("emoji input is capped at 16", () => {
    const html = panel(editorProject());
    expect(html.match(/<input[^>]*aria-label="Emoji"[^>]*>/g)).toHaveLength(3);
    expect(html).toMatch(/<input[^>]*maxLength="16"[^>]*aria-label="Emoji"[^>]*value="☀️"|<input[^>]*value="☀️"[^>]*/);
    expect(html).not.toMatch(/<input(?![^>]*maxLength="16")[^>]*aria-label="Emoji"/);
  });

  it("highlights the selected phrase", () => {
    const html = panel(editorProject(), { kind: "phrase", id: "ph-1" });
    expect(html).toMatch(/<li[^>]*id="phrase-ph-1"[^>]*aria-current="true"/);
    expect(html).not.toMatch(/id="phrase-ph-0"[^>]*aria-current/);
  });

  it("offers the spoken language with the project's language selected", () => {
    const html = panel(editorProject());
    expect(html).toContain('aria-label="Spoken language"');
    expect(html).toContain('<option value="tl">Tagalog</option>');
    expect(html).toMatch(/<option value="en" selected="">English<\/option>/);
    expect(html).toContain("Re-transcribe");
  });

  it("empty state picks the spoken language before generating", () => {
    const html = panel(editorProject({ phrases: [], language: null }));
    expect(html).toMatch(/<option value="" selected="">Auto-detect<\/option>/);
    expect(html).toContain("Generate captions");
  });

  it("empty state offers to generate captions", () => {
    expect(panel(editorProject({ phrases: [] }))).toContain("Generate captions");
  });
});
