CREATE TABLE IF NOT EXISTS lolo_admin_users (
 id UUID PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','content-manager','teacher','support')),
 totp_secret BYTEA NOT NULL,
 last_totp_step BIGINT NOT NULL DEFAULT -1,
 failures INTEGER NOT NULL DEFAULT 0,
 locked_until TIMESTAMPTZ,
 disabled_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lolo_admin_sessions (
 token_hash BYTEA PRIMARY KEY CHECK(octet_length(token_hash)=32),
 user_id UUID NOT NULL REFERENCES lolo_admin_users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS lolo_admin_sessions_user_idx ON lolo_admin_sessions(user_id);
CREATE TABLE IF NOT EXISTS lolo_admin_audit (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id UUID REFERENCES lolo_admin_users(id) ON DELETE SET NULL,
 action TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
