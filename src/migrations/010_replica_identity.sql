-- Set REPLICA IDENTITY FULL for all tables synced by PowerSync
-- This ensures that conflict resolution can use all columns and detects changes accurately.

ALTER TABLE categories REPLICA IDENTITY FULL;
ALTER TABLE products REPLICA IDENTITY FULL;
ALTER TABLE transactions REPLICA IDENTITY FULL;
ALTER TABLE expenses REPLICA IDENTITY FULL;
ALTER TABLE customers REPLICA IDENTITY FULL;
ALTER TABLE settings REPLICA IDENTITY FULL;
