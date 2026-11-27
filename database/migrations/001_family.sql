-- Initial family identity schema. Apply with the explicit operator command.
CREATE TABLE IF NOT EXISTS lolo_parents (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at TIMESTAMPTZ,
    CHECK (char_length(email) BETWEEN 3 AND 254)
);
CREATE TABLE IF NOT EXISTS lolo_parent_sessions (
    token_hash BYTEA PRIMARY KEY,
    parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (octet_length(token_hash) = 32)
);
CREATE INDEX IF NOT EXISTS lolo_parent_sessions_parent_idx ON lolo_parent_sessions(parent_id);
CREATE INDEX IF NOT EXISTS lolo_parent_sessions_expiry_idx ON lolo_parent_sessions(expires_at);
CREATE TABLE IF NOT EXISTS lolo_children (
    id UUID PRIMARY KEY,
    parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 40),
    age_band TEXT NOT NULL CHECK (age_band IN ('4-6','7-9','10-12','13-17','unspecified')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lolo_children_parent_idx ON lolo_children(parent_id);
-- Consent evidence is intentionally NOT inferred from a parent login or profile creation.
-- Live child services must not rely on this schema alone for eligibility or consent.
