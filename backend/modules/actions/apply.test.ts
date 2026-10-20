import request from "supertest";
import { readyProject, untilStatus } from "../../shared/apiTestHelpers";
import { makeTestDeps } from "../../shared/testing";
import type { Project } from "../../../shared/types";
import { applyActions } from "./apply";

let project: Project;
beforeAll(async () => {
  const { a, project: ready } = await readyProject(makeTestDeps());
  await request(a).post(`/api/projects/${ready.id}/plan`).send({ languages: ["es"] });
  await vi.waitFor(async () => expect((await untilStatus(a, ready.id, "ready")).editPlan).toBeTruthy());
  project = (await request(a).get(`/api/projects/${ready.id}`)).body;
});

describe("applyActions", () => {
  it("folds mixed actions into one patch", () => {
    const cut = project.editPlan!.cuts[0];
    const ph = project.phrases[1];
    const out = applyActions(project, [
      { type: "setTitle", title: "Morning routine" },
      { type: "editPhrase", phraseId: ph.id, text: "Totally new words here" },
      { type: "setCut", cutId: cut.id, shouldTrim: !cut.shouldTrim },
      { type: "setTemplate", captionTemplateId: "bold" },
    ]);
    if ("error" in out) throw new Error(out.error);
    expect(out.rerender).toBe(true);
    expect(out.patch.title).toBe("Morning routine");
    expect(out.patch.captionTemplateId).toBe("bold");
    expect(out.patch.editPlan!.cuts.find((c) => c.id === cut.id)!.shouldTrim).toBe(!cut.shouldTrim);
    const text = out.patch.phrases!.flatMap((p) => p.words.map((w) => w.text)).join(" ");
    expect(text).toContain("Totally new words here");
    expect(project.phrases[1]).toEqual(ph); // pure: the input is untouched
  });

  it("unknown ids fail the whole batch", () => {
    const out = applyActions(project, [
      { type: "setTitle", title: "x" },
      { type: "setCut", cutId: "cut-nope", shouldTrim: true },
    ]);
    expect(out).toEqual({ error: "unknown_id", id: "cut-nope" });
    expect(applyActions(project, [{ type: "editPhrase", phraseId: "ph-nope", text: "a" }])).toEqual({ error: "unknown_id", id: "ph-nope" });
    expect(applyActions(project, [{ type: "setShotKind", shotId: "shot-nope", kind: "Hook" }])).toEqual({ error: "unknown_id", id: "shot-nope" });
  });

  it("setTitle alone needs no rerender", () => {
    expect(applyActions(project, [{ type: "setTitle", title: "x" }])).toEqual({ patch: { title: "x" }, rerender: false });
    const shot = applyActions(project, [{ type: "setShotKind", shotId: "shot-0", kind: "B-Roll" }]);
    expect(shot).toMatchObject({ rerender: false });
  });

  it("setBurnIn requires a translation", () => {
    expect(applyActions(project, [{ type: "setBurnIn", language: "fr" }])).toEqual({ error: "bad_burn_in" });
    expect(applyActions(project, [{ type: "setBurnIn", language: "es" }])).toEqual({ patch: { burnInLanguage: "es" }, rerender: true });
  });

  it("plan and caption actions need a plan and captions", () => {
    const bare = { ...project, editPlan: null, phrases: [] };
    expect(applyActions(bare, [{ type: "setCut", cutId: "cut-0", shouldTrim: true }])).toEqual({ error: "no_plan" });
    expect(applyActions(bare, [{ type: "editPhrase", phraseId: "ph-0", text: "a" }])).toEqual({ error: "no_captions" });
  });
});
