UPDATE transactions
SET sync_recent_mobile = (timestamp >= now() - interval '7 days')
WHERE sync_recent_mobile IS DISTINCT FROM (timestamp >= now() - interval '7 days');

UPDATE expenses
SET sync_recent_mobile = (
  deleted_at IS NULL
  AND date >= now() - interval '7 days'
)
WHERE sync_recent_mobile IS DISTINCT FROM (
  deleted_at IS NULL
  AND date >= now() - interval '7 days'
);
