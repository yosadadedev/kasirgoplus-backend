-- Shift phase 2: cash in/out of the drawer during a shift, blind close, and force close.

-- Cash put into or taken out of the drawer outside of sales (receh for change, ice bought
-- from the drawer, cash handed to the owner). Kept apart from expenses because most of
-- these are not income or costs; when one is (e.g. an operational purchase), the app also
-- writes an expenses row and links it through expense_id.
CREATE TABLE IF NOT EXISTS cash_movements (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- No foreign key, same reason as transactions.shift_id (migration 024).
  shift_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('in', 'out')),
  amount bigint NOT NULL DEFAULT 0,
  reason text,
  expense_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0,
  sync_recent_mobile boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS cash_movements_tenant_shift_idx ON cash_movements(tenant_id, shift_id);

CREATE OR REPLACE FUNCTION cash_movement_is_recent_for_mobile(created_at timestamptz, deleted_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT deleted_at IS NULL AND created_at >= now() - interval '30 days'
$$;

CREATE OR REPLACE FUNCTION set_cash_movement_recent_sync_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sync_recent_mobile := cash_movement_is_recent_for_mobile(NEW.created_at, NEW.deleted_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cash_movements_recent_sync_flag ON cash_movements;
CREATE TRIGGER cash_movements_recent_sync_flag
BEFORE INSERT OR UPDATE ON cash_movements
FOR EACH ROW EXECUTE FUNCTION set_cash_movement_recent_sync_flag();

-- Same signature as migration 024; now also ages out cash movements. Returns rows changed.
CREATE OR REPLACE FUNCTION refresh_recent_shift_flags()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  shift_count bigint;
  movement_count bigint;
BEGIN
  UPDATE shifts
  SET sync_recent_mobile = shift_is_recent_for_mobile(opened_at, status, deleted_at)
  WHERE sync_recent_mobile IS DISTINCT FROM shift_is_recent_for_mobile(opened_at, status, deleted_at);
  GET DIAGNOSTICS shift_count = ROW_COUNT;

  UPDATE cash_movements
  SET sync_recent_mobile = cash_movement_is_recent_for_mobile(created_at, deleted_at)
  WHERE sync_recent_mobile IS DISTINCT FROM cash_movement_is_recent_for_mobile(created_at, deleted_at);
  GET DIAGNOSTICS movement_count = ROW_COUNT;

  RETURN shift_count + movement_count;
END;
$$;

-- Closed by the owner from another device (e.g. a forgotten shift). Nobody counted the
-- drawer, so counted_cash and difference stay NULL.
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS force_closed boolean NOT NULL DEFAULT false;

-- Blind close: cashiers enter the counted cash without seeing the expected amount first.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS shift_blind_close boolean NOT NULL DEFAULT false;
