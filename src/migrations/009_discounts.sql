CREATE TABLE IF NOT EXISTS discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('percentage', 'amount')),
  value bigint NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS discounts_tenant_id_idx ON discounts(tenant_id);
CREATE INDEX IF NOT EXISTS discounts_tenant_active_idx ON discounts(tenant_id, is_active) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS discounts_tenant_name_active_unique ON discounts(tenant_id, lower(name)) WHERE deleted_at IS NULL;
