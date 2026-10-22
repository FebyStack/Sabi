import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Pool } from "pg";
import type { Actor, OverlayMedia, Usage } from "../../../shared/types";

// One row per paid generation (spec row 20): no prompt text, no media, kept after the project is deleted.
export type LedgerEntry = {
  id: string; projectId: string | null; provider: "fal"; model: string; media: OverlayMedia; costCents: number;
  jobKind: "broll" | "generate"; actor: Actor; createdAt: string;
};

export interface CreditLedger {
  record(e: LedgerEntry): Promise<void>;
  since(from: Date): Promise<LedgerEntry[]>; // newest first
}

const MONTHS = 12;
const ROWS_PER_MONTH = 100;
const at = (e: LedgerEntry) => Date.parse(e.createdAt);
const newestFirst = (a: LedgerEntry, b: LedgerEntry) => at(b) - at(a);

export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const usageWindowStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1));

// The usage view: the last 12 UTC months that have rows, newest first; totals count every row, the list keeps 100 per month.
export function usageMonths(entries: LedgerEntry[], titles: Map<string, string>, now: Date): Usage["months"] {
  const from = usageWindowStart(now).getTime();
  const months = new Map<string, Usage["months"][number]>();
  for (const e of [...entries].sort(newestFirst)) {
    if (at(e) < from) continue;
    const key = new Date(e.createdAt).toISOString().slice(0, 7);
    const m = months.get(key) ?? { month: key, totalCents: 0, rows: [] };
    months.set(key, m);
    m.totalCents += e.costCents;
    if (m.rows.length < ROWS_PER_MONTH) {
      const { provider: _p, ...row } = e;
      m.rows.push({ ...row, projectTitle: (e.projectId && titles.get(e.projectId)) ?? null });
    }
  }
  return [...months.values()];
}

export class MemoryCreditLedger implements CreditLedger {
  private rows: LedgerEntry[] = [];
  async record(e: LedgerEntry) { this.rows.push({ ...e }); }
  async since(from: Date) { return this.rows.filter((e) => at(e) >= from.getTime()).sort(newestFirst); }
}

// dev:lite restarts on every save and still spends real fal money when FAL_KEY is set: its ledger is an append-only file.
export class JsonlCreditLedger implements CreditLedger {
  constructor(private path: string) {}
  async record(e: LedgerEntry) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(e)}\n`);
  }
  async since(from: Date) {
    const text = await readFile(this.path, "utf8").catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return ""; throw err; });
    const rows = text.split("\n").flatMap((line) => { try { return line ? [JSON.parse(line) as LedgerEntry] : []; } catch { return []; } });
    return rows.filter((e) => at(e) >= from.getTime()).sort(newestFirst);
  }
}

type Row = { id: string; project_id: string | null; provider: "fal"; model: string; media: OverlayMedia; cost_cents: number; job_kind: LedgerEntry["jobKind"]; actor: Actor; created_at: Date };

export class PgCreditLedger implements CreditLedger {
  constructor(private pool: Pool) {}
  async record(e: LedgerEntry) {
    await this.pool.query(
      "INSERT INTO credit_ledger (id, project_id, provider, model, media, cost_cents, job_kind, actor, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [e.id, e.projectId, e.provider, e.model, e.media, e.costCents, e.jobKind, e.actor, e.createdAt]);
  }
  async since(from: Date) {
    const { rows } = await this.pool.query<Row>("SELECT * FROM credit_ledger WHERE created_at >= $1 ORDER BY created_at DESC", [from]);
    return rows.map((r) => ({
      id: r.id, projectId: r.project_id, provider: r.provider, model: r.model, media: r.media, costCents: r.cost_cents,
      jobKind: r.job_kind, actor: r.actor, createdAt: r.created_at.toISOString(),
    }));
  }
}
