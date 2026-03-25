CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text NOT NULL,
  address text,
  city text,
  date_of_birth date,
  gender text,
  is_active boolean NOT NULL DEFAULT true,
  total_purchases integer NOT NULL DEFAULT 0,
  total_spent bigint NOT NULL DEFAULT 0,
  last_purchase_date timestamptz,
  loyalty_points integer NOT NULL DEFAULT 0,
  customer_type text NOT NULL DEFAULT 'regular',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_phone_uq ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS customers_tenant_id_idx ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS customers_tenant_name_idx ON customers(tenant_id, name);

