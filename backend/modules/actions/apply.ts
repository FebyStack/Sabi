import { retimePhrase } from "../../../shared/captions/retime";
import { carryEmoji, segmentCaptions } from "../../../shared/captions/segment";
import { getCaptionTemplate } from "../../../shared/captions/templates";
import type { Action, Project } from "../../../shared/types";
import { validatePlanEdit, type PlanEdit, type PlanEditError } from "../editplan/validate";

export type ApplyError = { error: PlanEditError["error"] | "no_captions"; id?: string };

// Pure: validate every action against the project, then fold them into one patch (all or nothing).
// `rerender` is true when the MP4 would change; shot kinds and titles don't touch it (until B-roll lands).
export function applyActions(project: Project, actions: Action[]): { patch: Partial<Project>; rerender: boolean } | ApplyError {
  const patch: Partial<Project> = {};
  const plan: PlanEdit = { cuts: [], shots: [] };
  const edits = new Map<string, string>();
  for (const a of actions) {
    if (a.type === "setTitle") patch.title = a.title;
    else if (a.type === "editPhrase") edits.set(a.phraseId, a.text);
    else if (a.type === "setCut") plan.cuts.push({ id: a.cutId, shouldTrim: a.shouldTrim });
    else if (a.type === "setShotKind") plan.shots.push({ id: a.shotId, kind: a.kind });
    else if (a.type === "setTemplate") patch.captionTemplateId = a.captionTemplateId;
    else plan.burnInLanguage = a.language;
  }

  if (edits.size && !project.phrases.length) return { error: "no_captions" };
  const missing = [...edits.keys()].find((id) => !project.phrases.some((p) => p.id === id));
  if (missing) return { error: "unknown_id", id: missing };
  const v = validatePlanEdit(project, plan);
  if ("error" in v) return v;

  if (plan.cuts.length || plan.shots.length) patch.editPlan = v.editPlan;
  if (v.burnInChanged) patch.burnInLanguage = plan.burnInLanguage;
  if (edits.size) patch.phrases = project.phrases.map((p) => (edits.has(p.id) ? retimePhrase(p, edits.get(p.id)!) : p));
  const templateChanged = patch.captionTemplateId !== undefined && patch.captionTemplateId !== project.captionTemplateId;
  if (templateChanged && project.phrases.length) {
    // The new layout re-flows the (edited) words now, so a still frame shows it before any render.
    const phrases = patch.phrases ?? project.phrases;
    patch.phrases = carryEmoji(phrases, segmentCaptions(phrases.flatMap((p) => p.words), getCaptionTemplate(patch.captionTemplateId!).layout));
  }
  return { patch, rerender: edits.size > 0 || templateChanged || v.cutsChanged || v.burnInChanged };
}
