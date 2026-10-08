-- Grace period for refresh token rotation: the previous refresh token stays valid
-- for a short window after rotation, so a client whose refresh response was lost
-- (timeout, flaky network, app killed) can retry instead of being force-logged-out.
ALTER TABLE device_sessions
  ADD COLUMN IF NOT EXISTS prev_refresh_token_hash text,
  ADD COLUMN IF NOT EXISTS rotated_at timestamptz;

CREATE INDEX IF NOT EXISTS device_sessions_prev_refresh_token_hash_idx
  ON device_sessions(prev_refresh_token_hash);
