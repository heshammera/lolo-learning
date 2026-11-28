-- Test device public-key binding and one-use proof challenges.
ALTER TABLE lolo_offline_test_devices ADD COLUMN IF NOT EXISTS key_digest BYTEA CHECK(key_digest IS NULL OR octet_length(key_digest)=32);
CREATE TABLE IF NOT EXISTS lolo_offline_test_challenges (
 id UUID PRIMARY KEY,
 parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
 device_id UUID NOT NULL,
 session_digest BYTEA NOT NULL CHECK(octet_length(session_digest)=32),
 public_key BYTEA NOT NULL CHECK(octet_length(public_key) BETWEEN 80 AND 128),
 nonce BYTEA NOT NULL CHECK(octet_length(nonce)=32),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP+INTERVAL '2 minutes',
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lolo_offline_test_challenges_parent ON lolo_offline_test_challenges(parent_id,expires_at);
