-- migrate: no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_created_by_timestamp_idx
ON transactions(created_by, timestamp DESC)
WHERE created_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS expenses_created_by_date_idx
ON expenses(created_by, date DESC)
WHERE created_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS device_sessions_user_id_active_idx
ON device_sessions(user_id)
WHERE revoked_at IS NULL;
