-- Disabled-by-default synthetic billing foundation. No payment provider credentials or card data.
CREATE TABLE IF NOT EXISTS lolo_billing_plans (
    id TEXT PRIMARY KEY CHECK (id IN ('free','plus','family')),
    monthly_minor INTEGER NOT NULL CHECK (monthly_minor BETWEEN 0 AND 100000000),
    yearly_minor INTEGER NOT NULL CHECK (yearly_minor BETWEEN 0 AND 100000000),
    child_limit INTEGER NOT NULL CHECK (child_limit BETWEEN 1 AND 12),
    voice_seconds INTEGER NOT NULL CHECK (voice_seconds BETWEEN 0 AND 360000),
    pronunciation_attempts INTEGER NOT NULL CHECK (pronunciation_attempts BETWEEN 0 AND 10000),
    enabled BOOLEAN NOT NULL DEFAULT true,
    CHECK ((id='free' AND monthly_minor=0 AND yearly_minor=0) OR
           (id<>'free' AND monthly_minor>0 AND yearly_minor>0))
);
INSERT INTO lolo_billing_plans(id,monthly_minor,yearly_minor,child_limit,voice_seconds,pronunciation_attempts)
VALUES ('free',0,0,1,300,0),('plus',14900,149000,1,3600,100),('family',29900,299000,4,9000,300)
ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS lolo_billing_orders (
    id UUID PRIMARY KEY,
    parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    plan_id TEXT NOT NULL REFERENCES lolo_billing_plans(id),
    period TEXT NOT NULL CHECK (period IN ('monthly','yearly')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor>0),
    currency TEXT NOT NULL CHECK (currency='EGP'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled','test_paid')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '15 minutes',
    UNIQUE(parent_id,operation_id)
);
CREATE TABLE IF NOT EXISTS lolo_billing_test_entitlements (
    parent_id UUID PRIMARY KEY REFERENCES lolo_parents(id) ON DELETE CASCADE,
    order_id UUID NOT NULL UNIQUE REFERENCES lolo_billing_orders(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES lolo_billing_plans(id),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at>starts_at)
);
