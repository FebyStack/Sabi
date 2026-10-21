import { Router } from "express";
import type { z } from "zod";
import { PlanInput, api } from "../../../shared/contract";
import { detectCuts } from "../../../shared/editing/cuts";
import type { JobState, Project, ProjectStatus, Translation } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";
import { projectLoader } from "../../shared/routes";
import { renderOutputs } from "../pipeline/pipeline";
import { TRANSLATE_BATCH, planEdit, translatePhrases } from "./planner";

// Job "plan": planning → plan → translate → (save) → rendering → ready. Nothing is saved until the LLM work succeeds,
// so a failure (Ollama down, model missing) leaves the previous status and outputs; a render failure keeps the plan.
export function startPlanJob(deps: AppDeps, project: Project, input: z.infer<typeof PlanInput>): JobState {
  return deps.jobs.enqueue(project.id, "plan", async ({ report }) => {
    const setStatus = async (status: ProjectStatus, patch: Partial<Project> = {}) => {
      const updated = await deps.projects.update(project.id, { status, ...patch });
      deps.bus.publish(project.id, { type: "project", status });
      return updated;
    };
    let saved = false;
    try {
      const source = await deps.assets.get(project.sourceAssetId!);
      if (!source) throw new Error("no_source");
      const durationMs = source.durationMs ?? 0;
      await setStatus("planning");
      report(10, "plan");
      const { shots, phrases } = await planEdit(deps.llm, project.phrases, durationMs);
      const cuts = detectCuts(project.transcript!.words, durationMs); // ASR words, not edited phrases

      const targets = input.languages.filter((l) => l !== project.language);
      const total = targets.length * Math.ceil(phrases.length / TRANSLATE_BATCH);
      let done = 0;
      const translations: Translation[] = [];
      for (const language of targets) {
        report(40 + (30 * done) / total, "translate");
        translations.push({ language, phrases: await translatePhrases(deps.llm, phrases, language, () => report(40 + (30 * ++done) / total, "translate")) });
      }
      const burnInLanguage = translations.some((t) => t.language === input.burnInLanguage) ? input.burnInLanguage : null;

      const current = await setStatus("rendering", { editPlan: { cuts, shots }, phrases, translations, burnInLanguage });
      saved = true;
      await setStatus("ready", { outputs: await renderOutputs(deps, current, source, report) });
      report(100);
    } catch (err) {
      await setStatus(saved ? "failed" : project.status);
      throw err;
    }
  });
}

export function editPlanRouter(deps: AppDeps) {
  const r = Router();

  const load = projectLoader(deps);

  r.post<{ id: string }>(api.projectPlan(":id"), async (req, res) => {
    const parsed = PlanInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const project = await load(req, res);
    if (!project) return;
    if (!project.transcript || !project.phrases.length) return res.status(400).json({ error: "no_captions" });
    if (deps.jobs.active(project.id)) return res.status(409).json({ error: "busy" });
    res.status(202).json({ jobId: startPlanJob(deps, project, parsed.data).id });
  });

  r.get<{ id: string }>(api.projectPlan(":id"), async (req, res) => {
    const project = await load(req, res);
    if (!project) return;
    if (!project.editPlan) return res.status(404).json({ error: "no_plan" });
    res.json(project.editPlan);
  });

  return r;
}
