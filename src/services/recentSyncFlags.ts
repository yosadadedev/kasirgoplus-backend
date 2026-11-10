import { sql } from "../db";

// Hourly is plenty: the mobile window is 7 days, and rows that linger an extra hour are harmless.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export const refreshRecentSyncFlags = async () => {
  const [row] = await sql<{ transactions_updated: string; expenses_updated: string }[]>`
    SELECT * FROM refresh_recent_sync_flags()
  `;
  // Closed shifts and cash movements leave the device after 30 days (migrations 024, 025).
  const [shiftRow] = await sql<{ refresh_recent_shift_flags: string }[]>`
    SELECT refresh_recent_shift_flags()
  `;
  return {
    transactionsUpdated: Number(row?.transactions_updated ?? 0),
    expensesUpdated: Number(row?.expenses_updated ?? 0),
    shiftsUpdated: Number(shiftRow?.refresh_recent_shift_flags ?? 0),
  };
};

let timer: ReturnType<typeof setInterval> | null = null;

/** Ages transactions/expenses/shifts out of the mobile sync window (see migrations 020, 024). */
export const startRecentSyncFlagsScheduler = () => {
  if (timer) return;
  const run = async () => {
    try {
      const result = await refreshRecentSyncFlags();
      if (result.transactionsUpdated || result.expensesUpdated || result.shiftsUpdated) {
        console.info("[recent-sync-flags]", result);
      }
    } catch (error) {
      console.error("[recent-sync-flags] refresh failed", error);
    }
  };
  void run();
  timer = setInterval(run, REFRESH_INTERVAL_MS);
};
