import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applySchema } from "../../backend/shared/pg";

// Real Postgres; opt in with PG_TEST_URL (npm run test:infra, after `make db`). Each case gets a throwaway database.
const url = process.env.PG_TEST_URL;

export async function withTestDb(fn: (pool: Pool) => Promise<void>) {
  const admin = new Pool({ connectionString: url });
  const name = `sabi_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const dbUrl = new URL(url!);
  dbUrl.pathname = `/${name}`;
  const pool = new Pool({ connectionString: dbUrl.toString() });
  try {
    await applySchema(pool);
    await fn(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}

describe.skipIf(!url)("postgres schema", { timeout: 60_000 }, () => {
  it("schema.sql applies twice", async () => {
    await withTestDb(async (pool) => {
      await applySchema(pool); // second time on the same database: every statement must be idempotent
      const { rows } = await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'projects'");
      expect(rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(["caption_style", "demo", "motion_graphics", "credits_used_cents", "edit_plan"]));
    });
  });
});
