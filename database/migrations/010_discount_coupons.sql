-- Synthetic discounts only. No payment provider changes.
CREATE TABLE IF NOT EXISTS lolo_billing_test_discounts (
 id UUID PRIMARY KEY, code_hash BYTEA NOT NULL UNIQUE CHECK(octet_length(code_hash)=32),
 campaign TEXT NOT NULL CHECK(char_length(campaign) BETWEEN 1 AND 60),
 plan_id TEXT NOT NULL REFERENCES lolo_billing_plans(id) CHECK(plan_id IN ('plus','family')),
 period TEXT NOT NULL CHECK(period IN ('monthly','yearly')),
 kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),
 value INTEGER NOT NULL CHECK(value>0 AND value<=100000000),
 max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 10000),
 expires_at TIMESTAMPTZ NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
 actor_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(kind<>'percent' OR value BETWEEN 1 AND 99)
);
ALTER TABLE lolo_billing_orders ADD COLUMN IF NOT EXISTS discount_id UUID REFERENCES lolo_billing_test_discounts(id);
ALTER TABLE lolo_billing_orders ADD COLUMN IF NOT EXISTS original_amount_minor INTEGER;
ALTER TABLE lolo_billing_orders ADD COLUMN IF NOT EXISTS discount_minor INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS lolo_discount_orders_idx ON lolo_billing_orders(discount_id,status);
