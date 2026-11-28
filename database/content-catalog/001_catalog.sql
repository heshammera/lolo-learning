-- Apply only to an empty, independent content-distribution database.
-- Give the student runtime a separate SELECT-only role. No user/child/admin records here.
CREATE TABLE IF NOT EXISTS lolo_public_content_catalog (
    draft_id UUID PRIMARY KEY,
    sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
    envelope JSONB NOT NULL CHECK(jsonb_typeof(envelope)='object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON lolo_public_content_catalog FROM PUBLIC;
