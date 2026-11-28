-- Apply ONLY to an independently reviewed disposable synthetic family pilot database.
CREATE TABLE IF NOT EXISTS lolo_pilot_family_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID NOT NULL,
  parent_id UUID NOT NULL,
  disabled BOOLEAN NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
