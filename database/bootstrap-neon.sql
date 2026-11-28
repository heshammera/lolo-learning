-- LOLO Learning: reviewed schema 001–015, commit 7e235d21f620087f5075c15e8ea6b413c5b8abbc
-- Run on dedicated LOLO Neon database only. No existing records deleted.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(17694321,99);

-- database/migrations/001_family.sql
-- Initial family identity schema. Apply with the explicit operator command.
CREATE TABLE IF NOT EXISTS lolo_parents (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at TIMESTAMPTZ,
    CHECK (char_length(email) BETWEEN 3 AND 254)
);
CREATE TABLE IF NOT EXISTS lolo_parent_sessions (
    token_hash BYTEA PRIMARY KEY,
    parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (octet_length(token_hash) = 32)
);
CREATE INDEX IF NOT EXISTS lolo_parent_sessions_parent_idx ON lolo_parent_sessions(parent_id);
CREATE INDEX IF NOT EXISTS lolo_parent_sessions_expiry_idx ON lolo_parent_sessions(expires_at);
CREATE TABLE IF NOT EXISTS lolo_children (
    id UUID PRIMARY KEY,
    parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 40),
    age_band TEXT NOT NULL CHECK (age_band IN ('4-6','7-9','10-12','13-17','unspecified')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lolo_children_parent_idx ON lolo_children(parent_id);
-- Consent evidence is intentionally NOT inferred from a parent login or profile creation.
-- Live child services must not rely on this schema alone for eligibility or consent.


-- database/migrations/002_progress.sql
-- Limited, self-reported learning snapshot. Never store voice recordings or transcripts here.
CREATE TABLE IF NOT EXISTS lolo_child_progress (
    child_id UUID PRIMARY KEY REFERENCES lolo_children(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision >= 1),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    last_operation UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- database/migrations/003_voice_consent.sql
-- Staging only. No audio, transcript, provider token or identity document.
CREATE TABLE IF NOT EXISTS lolo_voice_consent (
    child_id UUID NOT NULL REFERENCES lolo_children(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose = 'phoneme-assessment'),
    policy TEXT NOT NULL,
    receipt_digest TEXT NOT NULL CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
    granted_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > granted_at),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (child_id,purpose)
);


-- database/migrations/004_homework_staging.sql
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


-- database/migrations/005_homework_review.sql
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


-- database/migrations/006_billing_staging.sql
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


-- database/migrations/007_billing_usage_staging.sql
-- TEST ONLY. All quotas shared at parent account level.
CREATE TABLE IF NOT EXISTS lolo_billing_test_slots (
    child_id UUID PRIMARY KEY REFERENCES lolo_children(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lolo_billing_test_slots_parent ON lolo_billing_test_slots(parent_id);
CREATE TABLE IF NOT EXISTS lolo_billing_test_usage (
    parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    child_id UUID REFERENCES lolo_children(id) ON DELETE SET NULL,
    feature TEXT NOT NULL CHECK (feature IN ('voice','pronunciation')),
    units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 300),
    month DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(parent_id,operation_id)
);
CREATE INDEX IF NOT EXISTS lolo_billing_test_usage_month ON lolo_billing_test_usage(parent_id,month,feature);


-- database/migrations/008_billing_owner_audit.sql
ALTER TABLE lolo_billing_plans ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE TABLE IF NOT EXISTS lolo_billing_plan_audit (
 id BIGSERIAL PRIMARY KEY, actor_id UUID NOT NULL,
 plan_id TEXT NOT NULL REFERENCES lolo_billing_plans(id),
 before_policy JSONB NOT NULL, after_policy JSONB NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- database/migrations/009_manual_trial_grants.sql
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


-- database/migrations/010_discount_coupons.sql
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


-- database/migrations/011_offline_license_staging.sql
-- Synthetic offline license registry. Not a device attestation system.
CREATE TABLE IF NOT EXISTS lolo_offline_test_devices (
 parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
 device_id UUID NOT NULL UNIQUE,
 sequence BIGINT NOT NULL DEFAULT 0 CHECK(sequence BETWEEN 0 AND 9007199254740991),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TIMESTAMPTZ,
 PRIMARY KEY(parent_id,device_id)
);


-- database/migrations/012_offline_device_proof.sql
-- Test device public-key binding and one-use proof challenges.
ALTER TABLE lolo_offline_test_devices ADD COLUMN IF NOT EXISTS key_digest BYTEA CHECK(key_digest IS NULL OR octet_length(key_digest)=32);
CREATE TABLE IF NOT EXISTS lolo_offline_test_challenges (
 id UUID PRIMARY KEY,
 parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
 device_id UUID NOT NULL,
 session_digest BYTEA NOT NULL CHECK(octet_length(session_digest)=32),
 public_key BYTEA NOT NULL CHECK(octet_length(public_key) BETWEEN 80 AND 128),
 nonce BYTEA NOT NULL CHECK(octet_length(nonce)=32),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP+INTERVAL '2 minutes',
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lolo_offline_test_challenges_parent ON lolo_offline_test_challenges(parent_id,expires_at);


-- database/migrations/013_remote_config_staging.sql
-- Single synthetic configuration, revisioned and audited. No live service switches.
CREATE TABLE IF NOT EXISTS lolo_remote_test_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 policy JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO lolo_remote_test_config(id,policy) VALUES (1,'{"onlineMaintenance":false,"minimumAndroidVersionCode":1,"recommendedAndroidVersionCode":1,"message":"","voice":false,"pronunciation":false,"cloudSync":false,"homework":false}'::jsonb) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS lolo_remote_test_config_audit (
 id BIGSERIAL PRIMARY KEY,
 actor_id UUID NOT NULL,
 before_policy JSONB NOT NULL,
 after_policy JSONB NOT NULL,
 revision INTEGER NOT NULL UNIQUE CHECK(revision>1),
 changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- database/migrations/014_voice_receipt_replay.sql
-- Prevent a previously reviewed receipt from silently renewing or restoring consent.
CREATE TABLE IF NOT EXISTS lolo_voice_receipt_history (
 child_id UUID NOT NULL REFERENCES lolo_children(id) ON DELETE CASCADE,
 receipt_digest TEXT NOT NULL CHECK(receipt_digest ~ '^[a-f0-9]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(child_id,receipt_digest)
);
INSERT INTO lolo_voice_receipt_history(child_id,receipt_digest,recorded_at)
SELECT child_id,receipt_digest,granted_at FROM lolo_voice_consent ON CONFLICT DO NOTHING;


-- database/migrations/015_shared_request_budget.sql
CREATE TABLE IF NOT EXISTS lolo_shared_request_budget (
 bucket TEXT PRIMARY KEY CHECK(bucket IN ('paid-minute','paid-day','login-minute')),
 window_start TIMESTAMPTZ NOT NULL,
 used INTEGER NOT NULL CHECK(used>=0)
);

COMMIT;

-- Read-only verification: expect 26 of 26 tables.
SELECT count(*) AS lolo_tables_present, 26 AS expected_tables FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name IN ('lolo_parents', 'lolo_parent_sessions', 'lolo_children', 'lolo_child_progress', 'lolo_voice_consent', 'lolo_homework_assignments', 'lolo_homework_submissions', 'lolo_homework_review_grants', 'lolo_homework_reviews', 'lolo_billing_plans', 'lolo_billing_orders', 'lolo_billing_test_entitlements', 'lolo_billing_test_slots', 'lolo_billing_test_usage', 'lolo_billing_plan_audit', 'lolo_billing_test_grants', 'lolo_billing_test_coupons', 'lolo_billing_test_redemptions', 'lolo_billing_test_grant_audit', 'lolo_billing_test_discounts', 'lolo_offline_test_devices', 'lolo_offline_test_challenges', 'lolo_remote_test_config', 'lolo_remote_test_config_audit', 'lolo_voice_receipt_history', 'lolo_shared_request_budget');
