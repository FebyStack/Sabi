-- Idempotent; applied on every api boot (backend/shared/pg.ts).
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  org_id        TEXT,                                   -- nullable: solo users now, orgs later (spec §11.3)
  title         TEXT NOT NULL,
  aspect_ratio  TEXT NOT NULL CHECK (aspect_ratio IN ('9:16', '16:9')),
  media_source  TEXT NOT NULL CHECK (media_source IN ('generate', 'stock')),
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_access   TIMESTAMPTZ NOT NULL DEFAULT now()      -- 30-day retention sweep key (spec §11.2)
);
CREATE INDEX IF NOT EXISTS projects_created_idx ON projects (created_at DESC);
