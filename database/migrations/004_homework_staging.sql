-- Synthetic staging only. No public URLs, filenames, or original image metadata.
CREATE TABLE IF NOT EXISTS lolo_homework_assignments (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'),
    active BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS lolo_homework_submissions (
    id UUID PRIMARY KEY,
    child_id UUID NOT NULL REFERENCES lolo_children(id) ON DELETE CASCADE,
    assignment_id TEXT NOT NULL REFERENCES lolo_homework_assignments(id),
    image BYTEA NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 2097152),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS lolo_homework_child_idx ON lolo_homework_submissions(child_id);
CREATE INDEX IF NOT EXISTS lolo_homework_expiry_idx ON lolo_homework_submissions(expires_at);
