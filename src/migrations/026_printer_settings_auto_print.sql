-- Print the customer receipt automatically when a checkout completes.
ALTER TABLE printer_settings
  ADD COLUMN IF NOT EXISTS auto_print_receipt boolean NOT NULL DEFAULT false;
