ALTER TABLE categories
ADD COLUMN IF NOT EXISTS created_by uuid,
ADD COLUMN IF NOT EXISTS updated_by uuid,
ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
ADD COLUMN IF NOT EXISTS updated_seq bigint NOT NULL DEFAULT 0;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS created_by uuid,
ADD COLUMN IF NOT EXISTS updated_by uuid,
ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
ADD COLUMN IF NOT EXISTS updated_seq bigint NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS categories_tenant_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_name_active_unique ON categories(tenant_id, name) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS products_tenant_barcode_unique;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode_active_unique ON products(tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;

