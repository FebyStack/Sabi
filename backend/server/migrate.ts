import { applySchema, createPool } from "../shared/pg";

// `npm run db:migrate`: apply database/schema/schema.sql (idempotent) without booting the API, and say where.
const url = new URL(process.env.DATABASE_URL ?? "postgres://captions:captions@localhost:5433/captions");
const pool = createPool(url.toString());
try {
  await applySchema(pool);
  console.log(`schema applied to ${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`);
} finally {
  await pool.end();
}
