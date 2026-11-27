CREATE TABLE IF NOT EXISTS lolo_cms_delivery_sequence (
 draft_id UUID PRIMARY KEY REFERENCES lolo_cms_drafts(id),
 sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991)
);
