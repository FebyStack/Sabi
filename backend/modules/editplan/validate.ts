import type { EditPlan, Project, ShotKind, TranslationLanguage } from "../../../shared/types";

export type PlanEdit = { cuts: { id: string; shouldTrim: boolean }[]; shots: { id: string; kind: ShotKind }[]; burnInLanguage?: TranslationLanguage | null };
export type PlanEditError = { error: "no_plan" | "unknown_id" | "bad_burn_in"; id?: string };

// Shared by PATCH /plan and the agent's actions: ids must exist, burn-in must name a translation. Pure.
export function validatePlanEdit(project: Project, edit: PlanEdit):
  PlanEditError | { editPlan: EditPlan | null; burnInChanged: boolean; cutsChanged: boolean; shotsChanged: boolean } {
  const plan = project.editPlan;
  if (!plan && (edit.cuts.length || edit.shots.length)) return { error: "no_plan" };
  const unknown = edit.cuts.find((c) => !plan!.cuts.some((p) => p.id === c.id))?.id ?? edit.shots.find((s) => !plan!.shots.some((p) => p.id === s.id))?.id;
  if (unknown) return { error: "unknown_id", id: unknown };
  const { burnInLanguage } = edit;
  if (burnInLanguage && !project.translations.some((t) => t.language === burnInLanguage)) return { error: "bad_burn_in" };

  const trim = new Map(edit.cuts.map((c) => [c.id, c.shouldTrim]));
  const kinds = new Map(edit.shots.map((s) => [s.id, s.kind]));
  const editPlan = plan && {
    cuts: plan.cuts.map((c) => ({ ...c, shouldTrim: trim.get(c.id) ?? c.shouldTrim })),
    shots: plan.shots.map((s) => ({ ...s, kind: kinds.get(s.id) ?? s.kind })),
  };
  return {
    editPlan,
    burnInChanged: burnInLanguage !== undefined && burnInLanguage !== project.burnInLanguage,
    cutsChanged: !!editPlan && editPlan.cuts.some((c, i) => c.shouldTrim !== plan!.cuts[i].shouldTrim),
    shotsChanged: !!editPlan && editPlan.shots.some((s, i) => s.kind !== plan!.shots[i].kind),
  };
}
