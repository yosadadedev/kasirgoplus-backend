CREATE TABLE IF NOT EXISTS business_settings (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_name text NOT NULL DEFAULT '',
  business_address text NOT NULL DEFAULT '',
  business_phone text NOT NULL DEFAULT '',
  business_email text NOT NULL DEFAULT '',
  business_city text NOT NULL DEFAULT '',
  tax_rate int NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IDR',
  logo text,
  loyalty_per_amount bigint,
  loyalty_base_amount bigint,
  loyalty_points_per_base int,
  loyalty_rounding_mode text,
  loyalty_point_value bigint,
  vip_loyalty_base_amount bigint,
  vip_loyalty_points_per_base int,
  wholesale_loyalty_base_amount bigint,
  wholesale_loyalty_points_per_base int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS business_settings_tenant_active_unique ON business_settings(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS business_settings_tenant_id_idx ON business_settings(tenant_id);

DO $$
BEGIN
  IF to_regclass('public.settings') IS NOT NULL THEN
    INSERT INTO business_settings (
      id,
      tenant_id,
      business_name,
      business_address,
      business_phone,
      business_email,
      created_at,
      updated_at
    )
    SELECT
      'business_' || tenant_id::text,
      tenant_id,
      COALESCE(business_name, ''),
      COALESCE(business_address, ''),
      COALESCE(business_phone, ''),
      COALESCE(business_email, ''),
      COALESCE(created_at, now()),
      COALESCE(updated_at, now())
    FROM settings
    WHERE key = 'business'
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
