CREATE INDEX IF NOT EXISTS transactions_tenant_updated_at_idx ON transactions(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS expenses_tenant_updated_at_idx ON expenses(tenant_id, updated_at DESC);

