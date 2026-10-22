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
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_asset_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_kind TEXT CHECK (source_kind IN ('video', 'audio'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS caption_template_id TEXT NOT NULL DEFAULT 'clean';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS transcript JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS phrases JSONB NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS outputs JSONB NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_duration_ms INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS edit_plan JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS burn_in_language TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS overlays JSONB NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS credits_used_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brand JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS motion_graphics JSONB NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS caption_style JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('video', 'audio', 'image', 'render', 'subtitle')),
  key          TEXT NOT NULL,                             -- path under DATA_DIR
  mime_type    TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  duration_ms  INTEGER,
  width        INTEGER,
  height       INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_project_idx ON assets (project_id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS meta JSONB;                -- B-roll provenance: source, attribution, generation, prompt/query
