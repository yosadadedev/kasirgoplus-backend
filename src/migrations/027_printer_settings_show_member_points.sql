-- Print the member's loyalty points (earned, redeemed, balance) on the customer receipt.
ALTER TABLE printer_settings
  ADD COLUMN IF NOT EXISTS show_member_points boolean NOT NULL DEFAULT false;
