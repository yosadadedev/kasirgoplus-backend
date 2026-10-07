import { sql } from "../db";
import { refreshRecentSyncFlags } from "../services/recentSyncFlags";

try {
  const result = await refreshRecentSyncFlags();
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await sql.end({ timeout: 5 });
}
