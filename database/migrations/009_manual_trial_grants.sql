-- Independent from Paymob; synthetic entitlements only.
CREATE TABLE IF NOT EXISTS lolo_billing_test_grants (
 parent_id UUID PRIMARY KEY REFERENCES lolo_parents(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES lolo_billing_plans(id) CHECK(plan_id IN ('plus','family')),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at>starts_at),
 revoked_at TIMESTAMPTZ, revision INTEGER NOT NULL CHECK(revision>0),
 source TEXT NOT NULL CHECK(source IN ('manual','trial'))
);
CREATE TABLE IF NOT EXISTS lolo_billing_test_coupons (
 id UUID PRIMARY KEY, code_hash BYTEA NOT NULL UNIQUE CHECK(octet_length(code_hash)=32),
 campaign TEXT NOT NULL CHECK(char_length(campaign) BETWEEN 1 AND 60),
 plan_id TEXT NOT NULL REFERENCES lolo_billing_plans(id) CHECK(plan_id IN ('plus','family')),
 days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 90),
 max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 10000),
 expires_at TIMESTAMPTZ NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
 actor_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lolo_billing_test_redemptions (
 coupon_id UUID NOT NULL REFERENCES lolo_billing_test_coupons(id),
 parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
 redeemed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(coupon_id,parent_id)
);
CREATE TABLE IF NOT EXISTS lolo_billing_test_grant_audit (
 id BIGSERIAL PRIMARY KEY, parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
 actor_id UUID, action TEXT NOT NULL CHECK(action IN ('grant','extend','revoke','trial')),
 before_state JSONB, after_state JSONB NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Single effective access source; payment entitlements take precedence, never stack.
CREATE OR REPLACE VIEW lolo_billing_test_effective AS
 SELECT parent_id,plan_id,ends_at FROM lolo_billing_test_entitlements
 WHERE starts_at<=CURRENT_TIMESTAMP AND ends_at>CURRENT_TIMESTAMP
 UNION ALL
 SELECT g.parent_id,g.plan_id,g.ends_at FROM lolo_billing_test_grants g
 WHERE g.revoked_at IS NULL AND g.starts_at<=CURRENT_TIMESTAMP AND g.ends_at>CURRENT_TIMESTAMP
 AND NOT EXISTS(SELECT 1 FROM lolo_billing_test_entitlements e WHERE e.parent_id=g.parent_id AND e.starts_at<=CURRENT_TIMESTAMP AND e.ends_at>CURRENT_TIMESTAMP);
