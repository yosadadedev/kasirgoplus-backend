ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'expense';

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_type_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_type_check CHECK (type IN ('expense', 'income'));
