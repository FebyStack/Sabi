import type { Pool } from "pg";
import type { Asset } from "../../../shared/types";

export interface AssetRepository {
  get(id: string): Promise<Asset | null>;
  create(a: Asset): Promise<Asset>;
  listByProject(projectId: string): Promise<Asset[]>;
  removeByProject(projectId: string): Promise<void>;
}

export class MemoryAssetRepository implements AssetRepository {
  private rows = new Map<string, Asset>();
  async get(id: string) { return this.rows.get(id) ?? null; }
  async create(a: Asset) { this.rows.set(a.id, a); return a; }
  async listByProject(projectId: string) { return [...this.rows.values()].filter((a) => a.projectId === projectId); }
  async removeByProject(projectId: string) { for (const a of await this.listByProject(projectId)) this.rows.delete(a.id); }
}

type Row = { id: string; project_id: string | null; kind: Asset["kind"]; key: string; mime_type: string; size_bytes: string; duration_ms: number | null; width: number | null; height: number | null; meta: Asset["meta"] | null; created_at: Date };
const toAsset = (r: Row): Asset => ({
  id: r.id, projectId: r.project_id, kind: r.kind, key: r.key, mimeType: r.mime_type, sizeBytes: Number(r.size_bytes),
  durationMs: r.duration_ms ?? undefined, width: r.width ?? undefined, height: r.height ?? undefined, ...(r.meta ? { meta: r.meta } : {}), createdAt: r.created_at.toISOString(),
});

export class PgAssetRepository implements AssetRepository {
  constructor(private pool: Pool) {}
  async get(id: string) {
    const { rows } = await this.pool.query<Row>("SELECT * FROM assets WHERE id = $1", [id]);
    return rows[0] ? toAsset(rows[0]) : null;
  }
  async create(a: Asset) {
    const { rows } = await this.pool.query<Row>(
      "INSERT INTO assets (id, project_id, kind, key, mime_type, size_bytes, duration_ms, width, height, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [a.id, a.projectId, a.kind, a.key, a.mimeType, a.sizeBytes, a.durationMs ?? null, a.width ?? null, a.height ?? null, a.meta ? JSON.stringify(a.meta) : null, a.createdAt],
    );
    return toAsset(rows[0]);
  }
  async listByProject(projectId: string) {
    const { rows } = await this.pool.query<Row>("SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at", [projectId]);
    return rows.map(toAsset);
  }
  async removeByProject(projectId: string) { await this.pool.query("DELETE FROM assets WHERE project_id = $1", [projectId]); }
}
