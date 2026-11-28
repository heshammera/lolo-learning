-- Synthetic pilot only. Do not add to production migration list or Neon bootstrap.
CREATE TABLE IF NOT EXISTS lolo_pilot_credential_codes (
    email TEXT NOT NULL CHECK(email LIKE '%@example.test'),
    purpose TEXT NOT NULL CHECK(purpose IN ('register','reset')),
    code_hash BYTEA NOT NULL CHECK(octet_length(code_hash)=32),
    parent_id UUID REFERENCES lolo_parents(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(email,purpose),
    CHECK((purpose='register' AND parent_id IS NULL) OR (purpose='reset' AND parent_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS lolo_pilot_credential_expiry_idx ON lolo_pilot_credential_codes(expires_at);
