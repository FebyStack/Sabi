---
name: sabi-editor
description: Edit a Sabi video project through the sabi MCP tools — inspect, apply typed actions, verify with a rendered frame, re-render, export. Use when the user asks to edit captions, cuts, shots, templates, translations or exports of a Sabi project.
---

# Sabi editor

The `sabi` MCP server is a thin client of the running Sabi API. No model runs inside it: you are the editor, on the user's Claude subscription.

## The loop

1. `list_projects` → pick the id (or `create_project {title, path}` → `run_job captions` → `wait_job`).
2. `inspect_project {projectId}` → the summary. Keep its `baseVersion`.
3. Specifics only when needed: `inspect_project {section: "phrases", offset, limit}` or `{search: "<regex>"}` (word times), `{section: "plan"}` (every cut and shot).
4. `apply_actions {projectId, baseVersion, actions: [...]}` — batch every edit of the turn into one call, `render: false` while iterating. Each result gives the new `baseVersion`; use it next time.
5. `render_frame {projectId, timestampMs}` at the edited moment to check it. Frames are **output** time: when cuts are on, use the `→ out` / `(out …)` time inspect prints, not the source time.
6. Happy → `run_job {kind: "render"}` once (or `apply_actions` with `render: true`) → `wait_job`.
7. `export_outputs {projectId, outDir}` (an existing folder under the user's home).

Actions: `setTitle {title}`, `editPhrase {phraseId, text}` (timings kept; a different word count is spread over the phrase), `setCut {cutId, shouldTrim}`, `setShotKind {shotId, kind}`, `setTemplate {captionTemplateId: clean|bold|karaoke}`, `setBurnIn {language|null}` (only a language already translated). Max 50 per call; one bad id rejects the whole batch.

## Budget

- Summary first; never page through every phrase "just to look". Search instead.
- At most 4 `render_frame` calls per turn (each is an image in context).
- `run_job plan` recomputes cuts and shots (manual toggles are lost) and needs local Ollama: run it before fine edits, not after.

## When something fails

- `project changed since baseVersion … re-run inspect_project` — the user (web UI) or another session edited. Re-inspect, re-apply on the new state; never retry blindly.
- `busy: <kind> job …` — a job is running. `wait_job`, then re-inspect.
- `Sabi API not reachable …` — tell the user to start the API: `FAKE_AI=1 npm run dev:lite` (launch config `api-lite-fake`) or `npm run dev:lite`.
- `400 no_captions` — `run_job captions` first. `400 unknown_id` — the id came from a stale view; re-inspect.

## Examples

**Fix a misspelling** ("it says 'mourning', should be 'morning'"):
`inspect_project {search: "mourning"}` → `"mourning" ph-0 w-5 0:01.2–0:01.6` →
`apply_actions {actions: [{type: "editPhrase", phraseId: "ph-0", text: "<the phrase with morning>"}]}` (send the whole phrase text from `section: "phrases"`) →
`render_frame {timestampMs: 1400}` → `run_job render` → `wait_job`.

**Remove the pause at 0:05**:
`inspect_project {section: "plan"}` → find the `pause` cut spanning 0:05, e.g. `cut-3 pause 0:05.2–0:05.9 (off)` →
`apply_actions {actions: [{type: "setCut", cutId: "cut-3", shouldTrim: true}], render: true}` → `wait_job`.
No plan yet → `run_job plan` first (cuts start on).

**Bold template + Spanish burn-in**:
Summary shows `translations es`? → `apply_actions {actions: [{type: "setTemplate", captionTemplateId: "bold"}, {type: "setBurnIn", language: "es"}]}` →
`render_frame` once → `run_job render` → `wait_job`.
No `es` yet → `run_job {kind: "plan", languages: ["es"], burnInLanguage: "es"}` → `wait_job`, then `setTemplate` as above.
