ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS qris_image_url text,
  ADD COLUMN IF NOT EXISTS qris_merchant_name text,
  ADD COLUMN IF NOT EXISTS qris_active boolean NOT NULL DEFAULT false;
