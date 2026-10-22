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

// One database, one store: the first boot records where its files live; a boot with the other store would leave every
// project pointing at files that aren't there (and retention deleting from the wrong place), so it stops instead.
export async function ensureStorageMatches(pool: Pool, described: string) {
  await pool.query("INSERT INTO sabi_meta (key, value) VALUES ('storage', $1) ON CONFLICT (key) DO NOTHING", [described]);
  const { rows } = await pool.query<{ value: string }>("SELECT value FROM sabi_meta WHERE key = 'storage'");
  if (rows[0].value !== described)
    throw new Error(`this database's files are in ${rows[0].value}; set S3_ENDPOINT/DATA_DIR to match or use another DATABASE_URL`);
}
