CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total bigint NOT NULL DEFAULT 0,
  tax bigint NOT NULL DEFAULT 0,
  discount bigint NOT NULL DEFAULT 0,
  payment_method text NOT NULL,
  customer_name text,
  customer_phone text,
  cash_received bigint,
  change bigint,
  cashier text,
  timestamp timestamptz NOT NULL DEFAULT now(),
  is_edited boolean NOT NULL DEFAULT false,
  notes text,
  sequence_number text,
  table_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS transactions_tenant_time_idx ON transactions(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS transactions_tenant_id_idx ON transactions(tenant_id);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount bigint NOT NULL DEFAULT 0,
  category text NOT NULL,
  description text,
  date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS expenses_tenant_date_idx ON expenses(tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS expenses_tenant_id_idx ON expenses(tenant_id);

