import { sql } from "../db";

const updateRecentSyncFlags = async () => {
  const [transactions, expenses] = await Promise.all([
    sql<{ id: string }[]>`
      UPDATE transactions
      SET sync_recent_mobile = (timestamp >= now() - interval '30 days')
      WHERE sync_recent_mobile IS DISTINCT FROM (timestamp >= now() - interval '30 days')
      RETURNING id
    `,
    sql<{ id: string }[]>`
      UPDATE expenses
      SET sync_recent_mobile = (
        deleted_at IS NULL
        AND date >= now() - interval '30 days'
      )
      WHERE sync_recent_mobile IS DISTINCT FROM (
        deleted_at IS NULL
        AND date >= now() - interval '30 days'
      )
      RETURNING id
    `,
  ]);

  console.log(
    JSON.stringify({
      ok: true,
      transactionsUpdated: transactions.length,
      expensesUpdated: expenses.length,
    }),
  );
};

try {
  await updateRecentSyncFlags();
} finally {
  await sql.end({ timeout: 5 });
}
