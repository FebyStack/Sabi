import type { Actor, OverlayMedia } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";
import { FAL_MODELS, type GeneratedMedia } from "../../shared/generator";
import { monthStart } from "./ledger";

export class OverCap extends Error {
  constructor(readonly monthCents: number, readonly capCents: number) { super("over_cap"); }
}

// SPEND_CAP_CENTS: unset or empty → $20; 0 → no cap. An empty value must never mean "no cap" (spec row 20).
export function parseSpendCap(env: string | undefined): number {
  const v = env?.trim() ?? "";
  if (v === "") return 2000;
  if (!/^\d+$/.test(v)) throw new Error("SPEND_CAP_CENTS must be a whole number of cents (0 = no cap)");
  return Number(v);
}

export async function monthSpend(deps: Pick<AppDeps, "ledger" | "now">): Promise<number> {
  return (await deps.ledger.since(monthStart(deps.now()))).reduce((n, e) => n + e.costCents, 0);
}

// Throws OverCap when the cap is on and this cost would take the month past it.
export async function assertUnderCap(deps: Pick<AppDeps, "ledger" | "now" | "spendCapCents">, costCents: number): Promise<void> {
  if (deps.spendCapCents === 0) return;
  const month = await monthSpend(deps);
  if (month + costCents > deps.spendCapCents) throw new OverCap(month, deps.spendCapCents);
}

// The only way to call fal: the cap first, then the generation, whose ledger row is written the moment fal accepts the paid
// request — a generation that then times out or fails to import was still billed, and the cap must see it. onCharged lets the
// caller count it on the project too.
export async function chargeGeneration(deps: AppDeps, req: {
  projectId: string; prompt: string; media: OverlayMedia; width: number; height: number; jobKind: "broll" | "generate"; actor: Actor;
  onCharged?(costCents: number): void;
}): Promise<GeneratedMedia> {
  if (!deps.generator) throw new Error("generator_unavailable");
  await assertUnderCap(deps, FAL_MODELS[req.media].costCents);
  return deps.generator.generate({ prompt: req.prompt, media: req.media, width: req.width, height: req.height }, {
    onCharged: async ({ model, costCents }) => {
      await deps.ledger.record({
        id: deps.id(), projectId: req.projectId, provider: "fal", model, media: req.media, costCents,
        jobKind: req.jobKind, actor: req.actor, createdAt: deps.now().toISOString(),
      });
      req.onCharged?.(costCents);
    },
  });
}
