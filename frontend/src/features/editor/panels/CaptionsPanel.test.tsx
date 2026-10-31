import { renderToStaticMarkup } from "react-dom/server";
import { editorProject } from "@shared/editing/fixtures";
import type { Project, Services } from "@shared/types";
import { createEditorStore, type Selected } from "../store/editorStore";
import { CaptionsPanel, keepDrafts, nextEmphasis, phraseEdits } from "./CaptionsPanel";

// Record every element's props, so handlers can be called without a DOM.
const elements: { props: Record<string, unknown> }[] = [];
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const o = await orig<{ jsxDEV: (...a: unknown[]) => unknown }>();
  return { ...o, jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => { elements.push({ props }); return o.jsxDEV(type, props, ...rest); } };
});
const panel = (project: Project, selection: Selected | null = null, onGenerate: (language: string | null) => void = () => {}) =>
  renderToStaticMarkup(<CaptionsPanel project={project} store={createEditorStore({ selection })} commit={async () => {}} busy={false} onGenerate={onGenerate} />);
const withProps = (pred: (p: Record<string, unknown>) => boolean) => elements.find((e) => pred(e.props))!.props;

const services = (patch: Partial<Services> = {}): Services => ({ whisperx: "ok", ollama: "ok", ollamaModel: "qwen2.5:3b", stock: "ok", generator: "ok", ...patch });

describe("CaptionsPanel", () => {
  it("names a stopped whisperX before Generate, which stays available", () => {
    const empty = editorProject({ phrases: [], transcript: null });
    const html = (s: Services) => renderToStaticMarkup(<CaptionsPanel project={empty} store={createEditorStore({ selection: null })} commit={async () => {}} busy={false} onGenerate={() => {}} services={s} />);
    elements.length = 0;
    expect(html(services({ whisperx: "down" }))).toContain("No captions yet. whisperX isn&#x27;t running — start it with npm run ai:whisperx.");
    expect(withProps((p) => (p.action as { label?: string } | undefined)?.label === "Generate captions")).toBeTruthy();
    expect(html(services())).not.toContain("whisperX isn");
  });

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

  it("Auto-detect asks for detection, not the project's last language", () => {
    const onGenerate = vi.fn();
    elements.length = 0;
    panel(editorProject({ phrases: [], language: null }), null, onGenerate);
    (withProps((x) => (x.action as { label?: string } | undefined)?.label === "Generate captions").action as { onClick: () => void }).onClick();
    expect(onGenerate).toHaveBeenCalledWith(null);
  });

  it("re-transcribe asks first, then runs in the chosen language", () => {
    const onGenerate = vi.fn();
    vi.stubGlobal("confirm", vi.fn(() => true));
    elements.length = 0;
    panel(editorProject(), null, onGenerate);
    (withProps((x) => x.children === "Re-transcribe").onClick as () => void)();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("replaces the captions"));
    expect(onGenerate).toHaveBeenCalledWith("en");
    vi.unstubAllGlobals();
  });

  it("empty state offers to generate captions", () => {
    expect(panel(editorProject({ phrases: [] }))).toContain("Generate captions");
  });
});
