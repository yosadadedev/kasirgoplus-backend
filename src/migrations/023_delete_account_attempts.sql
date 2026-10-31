-- Brute-force guard for DELETE /v1/me: wrong passwords are counted per user, and the
-- account-deletion endpoint is locked for a while once the limit is hit. Stored in the
-- database (not memory) so a backend restart or redeploy doesn't reset the count.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS delete_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delete_locked_until timestamptz;
