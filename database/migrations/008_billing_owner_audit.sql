ALTER TABLE lolo_billing_plans ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE TABLE IF NOT EXISTS lolo_billing_plan_audit (
 id BIGSERIAL PRIMARY KEY, actor_id UUID NOT NULL,
 plan_id TEXT NOT NULL REFERENCES lolo_billing_plans(id),
 before_policy JSONB NOT NULL, after_policy JSONB NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
