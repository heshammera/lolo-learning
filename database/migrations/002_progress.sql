-- Limited, self-reported learning snapshot. Never store voice recordings or transcripts here.
CREATE TABLE IF NOT EXISTS lolo_child_progress (
    child_id UUID PRIMARY KEY REFERENCES lolo_children(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision >= 1),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    last_operation UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
