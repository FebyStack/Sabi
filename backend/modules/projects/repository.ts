import type { Pool } from "pg";
import type { Project } from "../../../shared/types";

export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  create(p: Project): Promise<Project>;
}

export class MemoryProjectRepository implements ProjectRepository {
  private rows = new Map<string, Project>();
  async list() { return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(id: string) { return this.rows.get(id) ?? null; }
  async create(p: Project) { this.rows.set(p.id, p); return p; }
}

type Row = { id: string; title: string; aspect_ratio: Project["aspectRatio"]; media_source: Project["mediaSource"]; status: Project["status"]; created_at: Date; updated_at: Date };
const toProject = (r: Row): Project => ({
  id: r.id, title: r.title, aspectRatio: r.aspect_ratio, mediaSource: r.media_source, status: r.status,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

export class PgProjectRepository implements ProjectRepository {
  constructor(private pool: Pool) {}
  async list() {
    const { rows } = await this.pool.query<Row>("SELECT * FROM projects ORDER BY created_at DESC");
    return rows.map(toProject);
  }
  async get(id: string) {
    const { rows } = await this.pool.query<Row>("SELECT * FROM projects WHERE id = $1", [id]);
    return rows[0] ? toProject(rows[0]) : null;
  }
  async create(p: Project) {
    const { rows } = await this.pool.query<Row>(
      "INSERT INTO projects (id, title, aspect_ratio, media_source, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [p.id, p.title, p.aspectRatio, p.mediaSource, p.status, p.createdAt, p.updatedAt],
    );
    return toProject(rows[0]);
  }
}
