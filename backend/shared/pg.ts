import { readFile } from "node:fs/promises";
import { Pool } from "pg";

export function createPool(connectionString: string) {
  return new Pool({ connectionString });
}

// schema.sql is idempotent; applied on every boot. Path is relative to cwd (repo root locally, /app in Docker).
export async function applySchema(pool: Pool) {
  const sql = await readFile("database/schema/schema.sql", "utf8");
  await pool.query(sql);
}
