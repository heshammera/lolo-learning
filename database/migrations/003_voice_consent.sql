-- Staging only. No audio, transcript, provider token or identity document.
CREATE TABLE IF NOT EXISTS lolo_voice_consent (
    child_id UUID NOT NULL REFERENCES lolo_children(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose = 'phoneme-assessment'),
    policy TEXT NOT NULL,
    receipt_digest TEXT NOT NULL CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
    granted_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > granted_at),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (child_id,purpose)
);
