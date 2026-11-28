-- Synthetic offline license registry. Not a device attestation system.
CREATE TABLE IF NOT EXISTS lolo_offline_test_devices (
 parent_id UUID NOT NULL REFERENCES lolo_parents(id) ON DELETE CASCADE,
 device_id UUID NOT NULL UNIQUE,
 sequence BIGINT NOT NULL DEFAULT 0 CHECK(sequence BETWEEN 0 AND 9007199254740991),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TIMESTAMPTZ,
 PRIMARY KEY(parent_id,device_id)
);
