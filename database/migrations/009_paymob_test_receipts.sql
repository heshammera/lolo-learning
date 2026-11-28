-- Synthetic Paymob correlation and accepted standalone payment receipts.
CREATE TABLE IF NOT EXISTS lolo_paymob_test_intentions (
 order_id UUID PRIMARY KEY REFERENCES lolo_billing_orders(id) ON DELETE CASCADE,
 provider_order_id BIGINT NOT NULL UNIQUE CHECK(provider_order_id>0),
 integration_id BIGINT NOT NULL CHECK(integration_id>0),
 provider_owner BIGINT NOT NULL CHECK(provider_owner>0),
 bound_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lolo_paymob_test_receipts (
 transaction_id BIGINT PRIMARY KEY CHECK(transaction_id>0),
 order_id UUID NOT NULL UNIQUE REFERENCES lolo_paymob_test_intentions(order_id) ON DELETE CASCADE,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 accepted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
