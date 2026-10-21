import type { Project } from "@shared/types";

type WithId = { id: string };
const differing = (a: WithId[], b: WithId[]) => {
  const before = new Map(a.map((x) => [x.id, JSON.stringify(x)]));
  const after = new Map(b.map((x) => [x.id, JSON.stringify(x)]));
  return [...new Set([...before.keys(), ...after.keys()])].filter((id) => before.get(id) !== after.get(id));
};

// What an edit from elsewhere (the agent, another tab) changed: layer ids plus project-wide tokens. The timeline pulses them.
export function changedIds(prev: Project, next: Project): string[] {
  const tokens: [string, unknown, unknown][] = [
    ["brand", prev.brand, next.brand], ["captionStyle", prev.captionStyle, next.captionStyle],
    ["template", prev.captionTemplateId, next.captionTemplateId], ["title", prev.title, next.title],
  ];
  return [
    ...differing(prev.overlays, next.overlays), ...differing(prev.motionGraphics, next.motionGraphics), ...differing(prev.phrases, next.phrases),
    ...differing(prev.editPlan?.shots ?? [], next.editPlan?.shots ?? []), ...differing(prev.editPlan?.cuts ?? [], next.editPlan?.cuts ?? []),
    ...tokens.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([t]) => t),
  ];
}

// Versions this tab wrote itself are not external.
export const isExternal = (next: Project, own: Set<string>) => !own.has(next.updatedAt);
