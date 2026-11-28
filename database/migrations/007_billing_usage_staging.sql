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
