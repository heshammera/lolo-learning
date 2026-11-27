CREATE TABLE IF NOT EXISTS lolo_cms_drafts (
 id UUID PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision>=1),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 created_by UUID NOT NULL REFERENCES lolo_admin_users(id),
 updated_by UUID NOT NULL REFERENCES lolo_admin_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
