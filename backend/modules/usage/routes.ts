import { Router } from "express";
import { api } from "../../../shared/contract";
import type { Catalog, Usage } from "../../../shared/types";
import type { AppDeps } from "../../shared/deps";
import { FAL_MODELS } from "../../shared/generator";
import { monthStart, usageMonths, usageWindowStart } from "./ledger";
import { monthSpend } from "./spend";

const MEDIA = ["image", "video"] as const;

export function usageRouter(deps: AppDeps) {
  const r = Router();

  // What the agent (model_catalog) and the web can use right now, and what it costs.
  r.get(api.catalog, async (_req, res) => {
    const body: Catalog = {
      models: [
        ...MEDIA.map((media) => ({ id: FAL_MODELS[media].id, provider: "fal" as const, media, costCents: FAL_MODELS[media].costCents, available: !!deps.generator })),
        ...MEDIA.map((media) => ({ id: media === "image" ? "pexels-photo" : "pexels-video", provider: "pexels" as const, media, costCents: 0, available: !!deps.stock })),
      ],
      spend: { monthCents: await monthSpend(deps), capCents: deps.spendCapCents },
    };
    res.json(body);
  });

  // Titles come from list(), never get(): reading usage must not count as opening a project (retention key).
  r.get(api.usage, async (_req, res) => {
    const now = deps.now();
    const titles = new Map((await deps.projects.list()).map((p) => [p.id, p.title]));
    const months = usageMonths(await deps.ledger.since(usageWindowStart(now)), titles, now);
    const current = monthStart(now).toISOString().slice(0, 7);
    const body: Usage = { capCents: deps.spendCapCents, monthCents: months[0]?.month === current ? months[0].totalCents : 0, months };
    res.json(body);
  });

  return r;
}
