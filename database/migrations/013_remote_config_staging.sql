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
