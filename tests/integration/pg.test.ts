import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgAssetRepository } from "../../backend/modules/assets/repository";
import { PgProjectRepository } from "../../backend/modules/projects/repository";
import { PgCreditLedger } from "../../backend/modules/usage/ledger";
import { applySchema, ensureStorageMatches } from "../../backend/shared/pg";
import { editorProject } from "../../shared/editing/fixtures";

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

  it("asset meta round-trips", async () => {
    await withTestDb(async (pool) => {
      await new PgProjectRepository(pool).create(editorProject({ updatedAt: "2026-10-21T00:00:00.000Z" }));
      const assets = new PgAssetRepository(pool);
      const meta = { source: "generated" as const, generationInfo: { provider: "fal" as const, model: "fal-ai/flux/schnell", prompt: "a sunrise", costCents: 1 }, prompt: "a sunrise" };
      const base = { projectId: "p1", kind: "image" as const, mimeType: "image/png", sizeBytes: 3, width: 1, height: 1, createdAt: "2026-10-22T00:00:00.000Z" };
      await assets.create({ ...base, id: "a1", key: "broll/a1.png", meta });
      await assets.create({ ...base, id: "a2", key: "uploads/a2.png" });
      expect((await assets.get("a1"))?.meta).toEqual(meta);
      expect(await assets.get("a2")).not.toHaveProperty("meta"); // uploads carry none
      expect((await assets.listByProject("p1")).map((a) => a.meta?.source)).toEqual(["generated", undefined]);
    });
  });

  it("pg credit ledger records and reads since a date", async () => {
    await withTestDb(async (pool) => {
      const ledger = new PgCreditLedger(pool);
      const e = { provider: "fal" as const, model: "fal-ai/flux/schnell", media: "image" as const, costCents: 1, jobKind: "broll" as const, actor: "agent" as const };
      await ledger.record({ ...e, id: "old", projectId: "gone", createdAt: "2026-09-30T23:59:59.000Z" });
      await ledger.record({ ...e, id: "new", projectId: null, createdAt: "2026-10-01T00:00:00.000Z" });
      expect(await ledger.since(new Date("2026-10-01T00:00:00.000Z"))).toEqual([{ ...e, id: "new", projectId: null, createdAt: "2026-10-01T00:00:00.000Z" }]);
      expect((await ledger.since(new Date(0))).map((r) => r.id)).toEqual(["new", "old"]);
      await expect(ledger.record({ ...e, id: "bad", projectId: null, actor: "robot" as "web", createdAt: "2026-10-02T00:00:00.000Z" })).rejects.toThrow(/check constraint/);
    });
  });

  it("the database refuses a second store", async () => {
    await withTestDb(async (pool) => {
      await ensureStorageMatches(pool, "fs:/Volumes/PortableSSD/Bong/captions-clone-data"); // first boot records it
      await ensureStorageMatches(pool, "fs:/Volumes/PortableSSD/Bong/captions-clone-data");
      await expect(ensureStorageMatches(pool, "s3:captions")).rejects.toThrow(
        "this database's files are in fs:/Volumes/PortableSSD/Bong/captions-clone-data; set S3_ENDPOINT/DATA_DIR to match or use another DATABASE_URL");
    });
  });
});

