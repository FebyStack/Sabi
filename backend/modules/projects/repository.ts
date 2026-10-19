import type { Pool } from "pg";
import type { Project } from "../../../shared/types";

export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>; // also bumps last_access (30-day retention key)
  create(p: Project): Promise<Project>;
  update(id: string, patch: Partial<Project>): Promise<Project>;
  failStuck(): Promise<number>; // on boot: no job survives a restart, so running statuses become failed
}

const RUNNING = ["transcribing", "planning", "generating", "rendering"];

export class MemoryProjectRepository implements ProjectRepository {
  private rows = new Map<string, Project>();
  async list() { return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(id: string) { return this.rows.get(id) ?? null; }
  async create(p: Project) { this.rows.set(p.id, p); return p; }
  async failStuck() {
    let n = 0;
    for (const p of this.rows.values()) if (RUNNING.includes(p.status)) { p.status = "failed"; n++; }
    return n;
  }
  async update(id: string, patch: Partial<Project>) {
    const cur = this.rows.get(id);
    if (!cur) throw new Error("not_found");
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.rows.set(id, next);
    return next;
  }
}

type Row = {
  id: string; title: string; aspect_ratio: Project["aspectRatio"]; media_source: Project["mediaSource"]; status: Project["status"];
  source_asset_id: string | null; source_kind: Project["sourceKind"]; language: string | null; caption_template_id: Project["captionTemplateId"];
  transcript: Project["transcript"]; phrases: Project["phrases"]; outputs: Project["outputs"]; warnings: string[];
  source_duration_ms: number | null; edit_plan: Project["editPlan"]; translations: Project["translations"]; burn_in_language: Project["burnInLanguage"];
  overlays: Project["overlays"]; credits_used_cents: number;
  created_at: Date; updated_at: Date;
};
const toProject = (r: Row): Project => ({
  id: r.id, title: r.title, aspectRatio: r.aspect_ratio, mediaSource: r.media_source, status: r.status,
  sourceAssetId: r.source_asset_id, sourceKind: r.source_kind ?? null, language: r.language, captionTemplateId: r.caption_template_id,
  transcript: r.transcript, phrases: r.phrases ?? [], outputs: r.outputs ?? {}, warnings: r.warnings ?? [],
  sourceDurationMs: r.source_duration_ms ?? null, editPlan: r.edit_plan ?? null, translations: r.translations ?? [], burnInLanguage: r.burn_in_language ?? null,
  overlays: r.overlays ?? [], creditsUsedCents: r.credits_used_cents ?? 0,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});
const COL: Record<keyof Omit<Project, "id" | "createdAt" | "updatedAt">, string> = {
  title: "title", aspectRatio: "aspect_ratio", mediaSource: "media_source", status: "status", sourceAssetId: "source_asset_id",
  sourceKind: "source_kind", language: "language", captionTemplateId: "caption_template_id", transcript: "transcript", phrases: "phrases", outputs: "outputs", warnings: "warnings",
  sourceDurationMs: "source_duration_ms", editPlan: "edit_plan", translations: "translations", burnInLanguage: "burn_in_language",
  overlays: "overlays", creditsUsedCents: "credits_used_cents",
};
const JSON_COLS = new Set(["transcript", "phrases", "outputs", "warnings", "editPlan", "translations", "overlays"]);

export class PgProjectRepository implements ProjectRepository {
  constructor(private pool: Pool) {}
  async list() {
    const { rows } = await this.pool.query<Row>("SELECT * FROM projects ORDER BY created_at DESC");
    return rows.map(toProject);
  }
  async get(id: string) {
    const { rows } = await this.pool.query<Row>("UPDATE projects SET last_access = now() WHERE id = $1 RETURNING *", [id]);
    return rows[0] ? toProject(rows[0]) : null;
  }
  async create(p: Project) {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO projects (id, title, aspect_ratio, media_source, status, source_asset_id, source_kind, language, caption_template_id, transcript, phrases, outputs, warnings,
         source_duration_ms, edit_plan, translations, burn_in_language, overlays, credits_used_cents, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [p.id, p.title, p.aspectRatio, p.mediaSource, p.status, p.sourceAssetId, p.sourceKind, p.language, p.captionTemplateId,
        JSON.stringify(p.transcript), JSON.stringify(p.phrases), JSON.stringify(p.outputs), JSON.stringify(p.warnings),
        p.sourceDurationMs, JSON.stringify(p.editPlan), JSON.stringify(p.translations), p.burnInLanguage,
        JSON.stringify(p.overlays), p.creditsUsedCents, p.createdAt, p.updatedAt],
    );
    return toProject(rows[0]);
  }
  async failStuck() {
    const { rowCount } = await this.pool.query("UPDATE projects SET status = 'failed', updated_at = now() WHERE status = ANY($1)", [RUNNING]);
    return rowCount ?? 0;
  }
  async update(id: string, patch: Partial<Project>) {
    const keys = (Object.keys(patch) as (keyof typeof COL)[]).filter((k) => k in COL);
    const sets = keys.map((k, i) => `${COL[k]} = $${i + 2}`);
    const vals = keys.map((k) => (JSON_COLS.has(k) ? JSON.stringify(patch[k]) : patch[k]));
    const { rows } = await this.pool.query<Row>(
      `UPDATE projects SET ${[...sets, "updated_at = now()"].join(", ")} WHERE id = $1 RETURNING *`, [id, ...vals]);
    if (!rows[0]) throw new Error("not_found");
    return toProject(rows[0]);
  }
}
