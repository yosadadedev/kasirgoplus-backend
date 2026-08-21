CREATE TABLE IF NOT EXISTS stock_movements (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id text REFERENCES products(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('sale', 'adjustment_add', 'adjustment_subtract', 'restore')),
  quantity_change integer NOT NULL DEFAULT 0,
  stock_before integer NOT NULL DEFAULT 0,
  stock_after integer NOT NULL DEFAULT 0,
  note text,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS stock_movements_tenant_product_idx ON stock_movements(tenant_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_tenant_created_idx ON stock_movements(tenant_id, created_at DESC);
