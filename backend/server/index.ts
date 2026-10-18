import { randomUUID } from "node:crypto";
import { createApp } from "../app/app";
import { PgProjectRepository } from "../modules/projects/repository";
import { applySchema, createPool } from "../shared/pg";

const port = Number(process.env.PORT ?? 3001);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (use `npm run dev:lite` for the in-memory server)");

const pool = createPool(url);
await applySchema(pool);

createApp({ projects: new PgProjectRepository(pool), now: () => new Date(), id: randomUUID })
  .listen(port, () => console.log(`api (postgres) on http://localhost:${port}`));
