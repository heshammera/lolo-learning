ALTER TABLE lolo_cms_drafts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved','published'));
ALTER TABLE lolo_cms_drafts ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES lolo_admin_users(id);
CREATE TABLE IF NOT EXISTS lolo_cms_releases (
 id UUID PRIMARY KEY,
 draft_id UUID NOT NULL REFERENCES lolo_cms_drafts(id),
 version INTEGER NOT NULL CHECK(version>=1),
 source_revision INTEGER NOT NULL,
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 reviewer_id UUID NOT NULL REFERENCES lolo_admin_users(id),
 publisher_id UUID NOT NULL REFERENCES lolo_admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(draft_id,version),
 UNIQUE(draft_id,id)
);
CREATE TABLE IF NOT EXISTS lolo_cms_active_release (
 draft_id UUID PRIMARY KEY REFERENCES lolo_cms_drafts(id),
 release_id UUID NOT NULL,
 FOREIGN KEY(draft_id,release_id) REFERENCES lolo_cms_releases(draft_id,id)
);
