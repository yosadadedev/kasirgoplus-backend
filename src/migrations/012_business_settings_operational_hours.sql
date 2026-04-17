ALTER TABLE business_settings
ADD COLUMN IF NOT EXISTS operational_open_time text NOT NULL DEFAULT '00:00',
ADD COLUMN IF NOT EXISTS operational_close_time text NOT NULL DEFAULT '23:59';
