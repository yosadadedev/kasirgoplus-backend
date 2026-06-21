ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS sync_recent_mobile boolean NOT NULL DEFAULT false;

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS sync_recent_mobile boolean NOT NULL DEFAULT false;

UPDATE transactions
SET sync_recent_mobile = (timestamp >= now() - interval '30 days');

UPDATE expenses
SET sync_recent_mobile = (
  deleted_at IS NULL
  AND date >= now() - interval '30 days'
);

CREATE INDEX IF NOT EXISTS transactions_tenant_recent_mobile_idx
ON transactions (tenant_id, sync_recent_mobile, timestamp DESC);

CREATE INDEX IF NOT EXISTS expenses_tenant_recent_mobile_idx
ON expenses (tenant_id, sync_recent_mobile, date DESC);
