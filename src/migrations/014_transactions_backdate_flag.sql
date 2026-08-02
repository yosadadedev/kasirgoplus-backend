ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS is_backdated boolean NOT NULL DEFAULT false;
