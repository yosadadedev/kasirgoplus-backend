-- Shift / Tutup Kasir. One shift = one working period of one cash drawer. The app opens and
-- closes shifts offline, so rows are written through PowerSync uploads like other POS data.
-- A shift belongs to a device (device_id), not to a user: several cashiers may sell on one
-- device, and the drawer is what gets counted at close.
CREATE TABLE IF NOT EXISTS shifts (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid,
  opened_by_name text,
  opening_cash bigint NOT NULL DEFAULT 0,
  closed_at timestamptz,
  closed_by uuid,
  closed_by_name text,
  -- Cash the cashier counted in the drawer at close.
  counted_cash bigint,
  -- Cash the drawer should hold at close, and counted_cash - expected_cash. Both are a
  -- snapshot taken on the device at close time, as is summary (per-method totals etc.),
  -- so later edits to the shift's transactions don't silently change a closed shift.
  expected_cash bigint,
  difference bigint,
  summary jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0,
  sync_recent_mobile boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS shifts_tenant_opened_idx ON shifts(tenant_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS shifts_tenant_device_status_idx ON shifts(tenant_id, device_id, status);

-- No foreign key to shifts on purpose: a sale and its shift reach the server in separate
-- upload batches, and a rejected batch is discarded by the app. A missing shift row must
-- never cost a sale.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS shift_id text,
  -- Kasbon settlement. Settling overwrites payment_method, so without these the cash from a
  -- week-old kasbon paid today would count toward the day of the original sale.
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by uuid,
  ADD COLUMN IF NOT EXISTS settled_shift_id text;
-- No index on these yet: shift totals are computed on the device, and a plain CREATE INDEX
-- would block writes to transactions (incoming sales) while it scans the table. Add one with
-- CREATE INDEX CONCURRENTLY outside a migration transaction once the server queries shifts.

-- When true, the app requires an open shift on the device before a sale can be saved.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS shift_enabled boolean NOT NULL DEFAULT false;

-- Mobile sync window for shifts: open shifts always (the device needs its own open shift),
-- closed ones for 30 days so the history list works offline.
CREATE OR REPLACE FUNCTION shift_is_recent_for_mobile(opened_at timestamptz, status text, deleted_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT deleted_at IS NULL AND (status = 'open' OR opened_at >= now() - interval '30 days')
$$;

CREATE OR REPLACE FUNCTION set_shift_recent_sync_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sync_recent_mobile := shift_is_recent_for_mobile(NEW.opened_at, NEW.status, NEW.deleted_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shifts_recent_sync_flag ON shifts;
CREATE TRIGGER shifts_recent_sync_flag
BEFORE INSERT OR UPDATE ON shifts
FOR EACH ROW EXECUTE FUNCTION set_shift_recent_sync_flag();

-- A kasbon settled recently stays on the device even when the sale itself is older than
-- 7 days: the open shift that received the cash sums it from the local database.
CREATE OR REPLACE FUNCTION transaction_is_recent_for_mobile(ts timestamptz, payment_method text, settled_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT ts >= now() - interval '7 days'
      OR lower(trim(coalesce(payment_method, ''))) = 'kasbon'
      OR (settled_at IS NOT NULL AND settled_at >= now() - interval '7 days')
$$;

CREATE OR REPLACE FUNCTION set_transaction_recent_sync_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sync_recent_mobile := transaction_is_recent_for_mobile(NEW."timestamp", NEW.payment_method, NEW.settled_at);
  RETURN NEW;
END;
$$;

-- Same contract as before (two counts), now using the 3-argument check for transactions.
CREATE OR REPLACE FUNCTION refresh_recent_sync_flags()
RETURNS TABLE (transactions_updated bigint, expenses_updated bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  tx_count bigint;
  ex_count bigint;
BEGIN
  UPDATE transactions
  SET sync_recent_mobile = transaction_is_recent_for_mobile("timestamp", payment_method, settled_at)
  WHERE sync_recent_mobile IS DISTINCT FROM transaction_is_recent_for_mobile("timestamp", payment_method, settled_at);
  GET DIAGNOSTICS tx_count = ROW_COUNT;

  UPDATE expenses
  SET sync_recent_mobile = expense_is_recent_for_mobile(date, deleted_at)
  WHERE sync_recent_mobile IS DISTINCT FROM expense_is_recent_for_mobile(date, deleted_at);
  GET DIAGNOSTICS ex_count = ROW_COUNT;

  RETURN QUERY SELECT tx_count, ex_count;
END;
$$;

DROP FUNCTION IF EXISTS transaction_is_recent_for_mobile(timestamptz, text);

CREATE OR REPLACE FUNCTION refresh_recent_shift_flags()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  shift_count bigint;
BEGIN
  UPDATE shifts
  SET sync_recent_mobile = shift_is_recent_for_mobile(opened_at, status, deleted_at)
  WHERE sync_recent_mobile IS DISTINCT FROM shift_is_recent_for_mobile(opened_at, status, deleted_at);
  GET DIAGNOSTICS shift_count = ROW_COUNT;
  RETURN shift_count;
END;
$$;
