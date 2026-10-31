-- Match the app and route defaults (58mm). Existing rows are left unchanged.
ALTER TABLE printer_settings
  ALTER COLUMN paper_size SET DEFAULT '58mm';
