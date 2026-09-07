DROP INDEX IF EXISTS customers_tenant_phone_uq;
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_phone_active_unique ON customers(tenant_id, phone) WHERE deleted_at IS NULL;
