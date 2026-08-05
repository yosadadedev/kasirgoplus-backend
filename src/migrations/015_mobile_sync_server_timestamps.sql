ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS last_mobile_mutation_at timestamptz;

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS last_mobile_mutation_at timestamptz;

UPDATE transactions
SET last_mobile_mutation_at = COALESCE(
  last_mobile_mutation_at,
  CASE
    WHEN sync_recent_mobile THEN now()
    ELSE NULL
  END
);

UPDATE expenses
SET last_mobile_mutation_at = COALESCE(
  last_mobile_mutation_at,
  CASE
    WHEN sync_recent_mobile THEN now()
    ELSE NULL
  END
);

UPDATE transactions
SET sync_recent_mobile = (
  last_mobile_mutation_at IS NOT NULL
  AND last_mobile_mutation_at >= now() - interval '30 days'
)
WHERE sync_recent_mobile IS DISTINCT FROM (
  last_mobile_mutation_at IS NOT NULL
  AND last_mobile_mutation_at >= now() - interval '30 days'
);

UPDATE expenses
SET sync_recent_mobile = (
  deleted_at IS NULL
  AND last_mobile_mutation_at IS NOT NULL
  AND last_mobile_mutation_at >= now() - interval '30 days'
)
WHERE sync_recent_mobile IS DISTINCT FROM (
  deleted_at IS NULL
  AND last_mobile_mutation_at IS NOT NULL
  AND last_mobile_mutation_at >= now() - interval '30 days'
);
