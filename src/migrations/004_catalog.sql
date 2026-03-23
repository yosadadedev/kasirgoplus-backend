CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  icon text,
  priority int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_name_unique ON categories(tenant_id, name);
CREATE INDEX IF NOT EXISTS categories_tenant_id_idx ON categories(tenant_id);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  price bigint NOT NULL DEFAULT 0,
  wholesale_price bigint,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  stock int NOT NULL DEFAULT 0,
  min_stock int,
  unit text,
  image text,
  barcode text,
  description text,
  variants jsonb,
  track_cost boolean NOT NULL DEFAULT false,
  cost bigint,
  priority int NOT NULL DEFAULT 0,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_tenant_id_idx ON products(tenant_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx ON products(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode_unique ON products(tenant_id, barcode) WHERE barcode IS NOT NULL;

