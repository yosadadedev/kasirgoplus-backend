-- Mobile devices only sync recent history (powersync/sync-config.yaml filters on
-- sync_recent_mobile). The flag is now computed by the database itself so every write
-- path (PowerSync upload, REST routes, manual SQL) stays consistent, and unpaid kasbon
-- always stays on the device regardless of age so it can still be settled there.
-- Rows age out via refresh_recent_sync_flags(), run periodically by the backend.

CREATE OR REPLACE FUNCTION transaction_is_recent_for_mobile(ts timestamptz, payment_method text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT ts >= now() - interval '7 days'
      OR lower(trim(coalesce(payment_method, ''))) = 'kasbon'
$$;

CREATE OR REPLACE FUNCTION expense_is_recent_for_mobile(d timestamptz, deleted_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT deleted_at IS NULL AND d >= now() - interval '7 days'
$$;

CREATE OR REPLACE FUNCTION set_transaction_recent_sync_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sync_recent_mobile := transaction_is_recent_for_mobile(NEW."timestamp", NEW.payment_method);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION set_expense_recent_sync_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sync_recent_mobile := expense_is_recent_for_mobile(NEW.date, NEW.deleted_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_recent_sync_flag ON transactions;
CREATE TRIGGER transactions_recent_sync_flag
BEFORE INSERT OR UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION set_transaction_recent_sync_flag();

DROP TRIGGER IF EXISTS expenses_recent_sync_flag ON expenses;
CREATE TRIGGER expenses_recent_sync_flag
BEFORE INSERT OR UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION set_expense_recent_sync_flag();

-- Re-evaluates rows whose flag is stale (mostly rows that just aged past 7 days).
-- Only touches rows that actually change, so PowerSync replicates the minimum.
CREATE OR REPLACE FUNCTION refresh_recent_sync_flags()
RETURNS TABLE (transactions_updated bigint, expenses_updated bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  tx_count bigint;
  ex_count bigint;
BEGIN
  UPDATE transactions
  SET sync_recent_mobile = transaction_is_recent_for_mobile("timestamp", payment_method)
  WHERE sync_recent_mobile IS DISTINCT FROM transaction_is_recent_for_mobile("timestamp", payment_method);
  GET DIAGNOSTICS tx_count = ROW_COUNT;

  UPDATE expenses
  SET sync_recent_mobile = expense_is_recent_for_mobile(date, deleted_at)
  WHERE sync_recent_mobile IS DISTINCT FROM expense_is_recent_for_mobile(date, deleted_at);
  GET DIAGNOSTICS ex_count = ROW_COUNT;

  RETURN QUERY SELECT tx_count, ex_count;
END;
$$;

SELECT * FROM refresh_recent_sync_flags();
