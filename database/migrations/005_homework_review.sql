-- Synthetic staging only. Teacher identity comes from the separate authenticated admin service.
CREATE TABLE IF NOT EXISTS lolo_homework_review_grants (
    child_id UUID NOT NULL REFERENCES lolo_children(id) ON DELETE CASCADE,
    assignment_id TEXT NOT NULL REFERENCES lolo_homework_assignments(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL,
    PRIMARY KEY(child_id,assignment_id,reviewer_id)
);
CREATE TABLE IF NOT EXISTS lolo_homework_reviews (
    submission_id UUID PRIMARY KEY REFERENCES lolo_homework_submissions(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('reviewed','revise')),
    score SMALLINT CHECK (score BETWEEN 0 AND 100),
    feedback TEXT NOT NULL CHECK (char_length(feedback) BETWEEN 1 AND 500),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((outcome='reviewed' AND score IS NOT NULL) OR (outcome='revise' AND score IS NULL))
);
