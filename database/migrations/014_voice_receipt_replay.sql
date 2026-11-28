-- Prevent a previously reviewed receipt from silently renewing or restoring consent.
CREATE TABLE IF NOT EXISTS lolo_voice_receipt_history (
 child_id UUID NOT NULL REFERENCES lolo_children(id) ON DELETE CASCADE,
 receipt_digest TEXT NOT NULL CHECK(receipt_digest ~ '^[a-f0-9]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(child_id,receipt_digest)
);
INSERT INTO lolo_voice_receipt_history(child_id,receipt_digest,recorded_at)
SELECT child_id,receipt_digest,granted_at FROM lolo_voice_consent ON CONFLICT DO NOTHING;
