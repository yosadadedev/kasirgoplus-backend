import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";

const SummaryQuerySchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  period: z
    .enum(["today", "yesterday", "week", "lastWeek", "month", "lastMonth", "year", "custom"])
    .optional()
    .default("custom"),
});

const toIso = (d: Date) => d.toISOString();

export const reportsRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/summary", async (c: any) => {
    const authUser = c.get("authUser")!;
    const q = SummaryQuerySchema.parse(c.req.query());
    const start = new Date(q.start);
    const end = new Date(q.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      return c.json({ error: "VALIDATION_ERROR", issues: [{ path: ["start", "end"], message: "Invalid date" }] }, 400);
    }

    const startIso = toIso(start);
    const endIso = toIso(end);

    const summaryRows = (await sql`
      WITH tx AS (
        SELECT *
        FROM transactions
        WHERE tenant_id = ${authUser.tenantId}
          AND deleted_at IS NULL
          AND timestamp >= ${startIso}
          AND timestamp <= ${endIso}
      ),
      tx_items AS (
        SELECT
          t.id as tx_id,
          (t.total - t.tax) as tx_revenue,
          COALESCE(items_sum.sum_subtotal, 0) as sum_subtotal,
          it.value as item
        FROM tx t
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM((e.value->>'subtotal')::numeric), 0) as sum_subtotal
          FROM jsonb_array_elements(t.items) e(value)
        ) items_sum ON true
        LEFT JOIN LATERAL jsonb_array_elements(t.items) it(value) ON true
      ),
      product_profit AS (
        SELECT
          (item->'product'->>'id') as product_id,
          COALESCE(item->'product'->>'name', '') as name,
          COALESCE(item->'product'->>'category', '') as category,
          COALESCE(SUM((item->>'quantity')::numeric), 0) as quantity,
          COALESCE(SUM((item->>'subtotal')::numeric), 0) as revenue_raw,
          COALESCE(SUM(
            (
              CASE
                WHEN sum_subtotal > 0 THEN tx_revenue * ((item->>'subtotal')::numeric / sum_subtotal)
                ELSE 0
              END
            )
            -
            (
              CASE
                WHEN COALESCE((item->'product'->>'trackCost')::boolean, true)
                  THEN COALESCE((item->'product'->>'cost')::numeric, (item->'product'->>'wholesalePrice')::numeric, 0) * ((item->>'quantity')::numeric)
                ELSE 0
              END
            )
          ), 0) as profit
        FROM tx_items
        WHERE item IS NOT NULL
          AND (item->'product'->>'id') IS NOT NULL
        GROUP BY product_id, name, category
      ),
      profit_ranked AS (
        SELECT
          product_id,
          name,
          category,
          quantity,
          revenue_raw,
          profit,
          CASE WHEN quantity > 0 THEN profit / quantity ELSE 0 END as avg_profit_per_unit
        FROM product_profit
      ),
      profit_top AS (
        SELECT * FROM profit_ranked ORDER BY profit DESC LIMIT 50
      ),
      sales_top AS (
        SELECT
          (item->'product'->>'id') as product_id,
          COALESCE(item->'product'->>'name', '') as name,
          COALESCE(item->'product'->>'category', '') as category,
          COALESCE(SUM((item->>'quantity')::numeric), 0) as quantity,
          COALESCE(SUM((item->>'subtotal')::numeric), 0) as revenue
        FROM tx_items
        WHERE item IS NOT NULL
          AND (item->'product'->>'id') IS NOT NULL
        GROUP BY product_id, name, category
      ),
      sales_top_ranked AS (
        SELECT * FROM sales_top ORDER BY revenue DESC
      ),
      sales_bottom_ranked AS (
        SELECT * FROM sales_top ORDER BY revenue ASC
      ),
      no_cost AS (
        SELECT DISTINCT (item->'product'->>'id') as product_id
        FROM tx_items
        WHERE item IS NOT NULL
          AND (item->'product'->>'id') IS NOT NULL
          AND COALESCE((item->'product'->>'trackCost')::boolean, true) = true
          AND COALESCE((item->'product'->>'cost')::numeric, (item->'product'->>'wholesalePrice')::numeric, 0) <= 0
      )
      SELECT
        (SELECT COALESCE(SUM(total)::numeric, 0) FROM tx) as total_sales,
        (SELECT COUNT(*) FROM tx) as total_transactions,
        (SELECT COALESCE(SUM(total - tax)::numeric, 0) FROM tx) as total_revenue_ex_tax,
        (SELECT COALESCE(SUM(
          CASE
            WHEN item IS NULL THEN 0
            WHEN COALESCE((item->'product'->>'trackCost')::boolean, true)
              THEN COALESCE((item->'product'->>'cost')::numeric, (item->'product'->>'wholesalePrice')::numeric, 0) * ((item->>'quantity')::numeric)
            ELSE 0
          END
        )::numeric, 0) FROM tx_items) as total_cost,
        (SELECT COALESCE(SUM(amount)::numeric, 0) FROM expenses
          WHERE tenant_id = ${authUser.tenantId}
            AND deleted_at IS NULL
            AND date >= ${startIso}
            AND date <= ${endIso}
        ) as total_expenses,
        (SELECT COUNT(*) FROM no_cost) as items_without_cost,
        (SELECT jsonb_agg(jsonb_build_object(
          'id', product_id,
          'name', name,
          'category', category,
          'quantity', quantity,
          'revenue', revenue
        )) FROM (SELECT * FROM sales_top_ranked LIMIT 50) s) as top_products_all,
        (SELECT jsonb_agg(jsonb_build_object(
          'id', product_id,
          'name', name,
          'category', category,
          'quantity', quantity,
          'revenue', revenue
        )) FROM (SELECT * FROM sales_top_ranked LIMIT 10) s) as top_products,
        (SELECT jsonb_agg(jsonb_build_object(
          'id', product_id,
          'name', name,
          'category', category,
          'quantity', quantity,
          'revenue', revenue
        )) FROM (SELECT * FROM sales_bottom_ranked LIMIT 10) s) as bottom_products,
        (SELECT jsonb_agg(jsonb_build_object(
          'id', product_id,
          'name', name,
          'category', category,
          'quantity', quantity,
          'revenue', revenue_raw,
          'cost', 0,
          'profit', profit,
          'avgProfitPerUnit', avg_profit_per_unit
        )) FROM (SELECT * FROM profit_top LIMIT 50) p) as profit_products_all,
        (SELECT jsonb_agg(jsonb_build_object(
          'id', product_id,
          'name', name,
          'category', category,
          'quantity', quantity,
          'revenue', revenue_raw,
          'cost', 0,
          'profit', profit,
          'avgProfitPerUnit', avg_profit_per_unit
        )) FROM (SELECT * FROM profit_top LIMIT 10) p) as top_profit_products
    `) as unknown as {
      total_sales: string | number;
      total_transactions: string | number;
      total_revenue_ex_tax: string | number;
      total_cost: string | number;
      total_expenses: string | number;
      items_without_cost: string | number;
      top_products_all: any;
      top_products: any;
      bottom_products: any;
      profit_products_all: any;
      top_profit_products: any;
    }[];

    const s = summaryRows[0] ?? ({} as any);
    const totalSales = Number(s.total_sales) || 0;
    const totalTransactions = Number(s.total_transactions) || 0;
    const totalRevenueExTax = Number(s.total_revenue_ex_tax) || 0;
    const totalCost = Number(s.total_cost) || 0;
    const totalExpenses = Number(s.total_expenses) || 0;
    const totalProfit = totalRevenueExTax - totalCost;
    const netProfit = totalProfit - totalExpenses;
    const avgTransactionValue = totalTransactions > 0 ? totalSales / totalTransactions : 0;
    const itemsWithoutCost = Number(s.items_without_cost) || 0;

    const paymentRows = (await sql`
      SELECT
        payment_method,
        COUNT(*)::int as c,
        COALESCE(SUM(total)::numeric, 0) as total
      FROM transactions
      WHERE tenant_id = ${authUser.tenantId}
        AND deleted_at IS NULL
        AND timestamp >= ${startIso}
        AND timestamp <= ${endIso}
      GROUP BY payment_method
    `) as unknown as { payment_method: string; c: number; total: string | number }[];

    const paymentTotals: Record<string, number> = { cash: 0, qris: 0, transfer: 0, kasbon: 0 };
    const paymentCounts: Record<string, number> = { cash: 0, qris: 0, transfer: 0, kasbon: 0 };
    for (const r of paymentRows) {
      const k = String(r.payment_method);
      if (paymentTotals[k] === undefined) continue;
      paymentTotals[k] = Number(r.total) || 0;
      paymentCounts[k] = Number(r.c) || 0;
    }

    const period = q.period;
    let series: { period: string; sales: number; transactions: number; avgTransaction: number }[] = [];
    if (["today", "yesterday"].includes(period)) {
      const rows = (await sql`
        SELECT
          FLOOR(EXTRACT(epoch FROM (timestamp - ${startIso}::timestamptz)) / 3600)::int as slot,
          COUNT(*)::int as c,
          COALESCE(SUM(total)::numeric, 0) as total
        FROM transactions
        WHERE tenant_id = ${authUser.tenantId}
          AND deleted_at IS NULL
          AND timestamp >= ${startIso}
          AND timestamp <= ${endIso}
        GROUP BY slot
      `) as unknown as { slot: number; c: number; total: string | number }[];
      const map = new Map<number, { c: number; total: number }>();
      for (const r of rows) {
        if (!Number.isFinite(r.slot)) continue;
        map.set(r.slot, { c: Number(r.c) || 0, total: Number(r.total) || 0 });
      }
      series = Array.from({ length: 24 }).map((_, i) => {
        const v = map.get(i) ?? { c: 0, total: 0 };
        return {
          period: new Date(start.getTime() + i * 3600 * 1000).toISOString(),
          sales: v.total,
          transactions: v.c,
          avgTransaction: v.c > 0 ? v.total / v.c : 0,
        };
      });
    } else if (["week", "lastWeek"].includes(period)) {
      const rows = (await sql`
        SELECT
          FLOOR(EXTRACT(epoch FROM (timestamp - ${startIso}::timestamptz)) / 86400)::int as slot,
          COUNT(*)::int as c,
          COALESCE(SUM(total)::numeric, 0) as total
        FROM transactions
        WHERE tenant_id = ${authUser.tenantId}
          AND deleted_at IS NULL
          AND timestamp >= ${startIso}
          AND timestamp <= ${endIso}
        GROUP BY slot
      `) as unknown as { slot: number; c: number; total: string | number }[];
      const map = new Map<number, { c: number; total: number }>();
      for (const r of rows) {
        if (!Number.isFinite(r.slot)) continue;
        map.set(r.slot, { c: Number(r.c) || 0, total: Number(r.total) || 0 });
      }
      series = Array.from({ length: 7 }).map((_, i) => {
        const v = map.get(i) ?? { c: 0, total: 0 };
        return {
          period: new Date(start.getTime() + i * 86400 * 1000).toISOString(),
          sales: v.total,
          transactions: v.c,
          avgTransaction: v.c > 0 ? v.total / v.c : 0,
        };
      });
    } else if (["month", "lastMonth", "custom"].includes(period)) {
      const dayCount = Math.max(1, Math.min(366, Math.ceil((end.getTime() - start.getTime()) / (86400 * 1000))));
      const rows = (await sql`
        SELECT
          FLOOR(EXTRACT(epoch FROM (timestamp - ${startIso}::timestamptz)) / 86400)::int as slot,
          COUNT(*)::int as c,
          COALESCE(SUM(total)::numeric, 0) as total
        FROM transactions
        WHERE tenant_id = ${authUser.tenantId}
          AND deleted_at IS NULL
          AND timestamp >= ${startIso}
          AND timestamp <= ${endIso}
        GROUP BY slot
      `) as unknown as { slot: number; c: number; total: string | number }[];
      const map = new Map<number, { c: number; total: number }>();
      for (const r of rows) {
        if (!Number.isFinite(r.slot)) continue;
        map.set(r.slot, { c: Number(r.c) || 0, total: Number(r.total) || 0 });
      }
      series = Array.from({ length: dayCount }).map((_, i) => {
        const v = map.get(i) ?? { c: 0, total: 0 };
        return {
          period: new Date(start.getTime() + i * 86400 * 1000).toISOString(),
          sales: v.total,
          transactions: v.c,
          avgTransaction: v.c > 0 ? v.total / v.c : 0,
        };
      });
    } else if (period === "year") {
      const rows = (await sql`
        SELECT
          DATE_TRUNC('month', timestamp) as bucket,
          COUNT(*)::int as c,
          COALESCE(SUM(total)::numeric, 0) as total
        FROM transactions
        WHERE tenant_id = ${authUser.tenantId}
          AND deleted_at IS NULL
          AND timestamp >= ${startIso}
          AND timestamp <= ${endIso}
        GROUP BY bucket
        ORDER BY bucket ASC
      `) as unknown as { bucket: string; c: number; total: string | number }[];
      const map = new Map<number, { c: number; total: number }>();
      for (const r of rows) {
        const t = new Date(r.bucket).getTime();
        if (!Number.isFinite(t)) continue;
        map.set(new Date(r.bucket).getMonth(), { c: Number(r.c) || 0, total: Number(r.total) || 0 });
      }
      const startMonth = start.getMonth();
      series = Array.from({ length: 12 }).map((_, i) => {
        const month = (startMonth + i) % 12;
        const v = map.get(month) ?? { c: 0, total: 0 };
        const d = new Date(start.getFullYear(), month, 1);
        return {
          period: d.toISOString(),
          sales: v.total,
          transactions: v.c,
          avgTransaction: v.c > 0 ? v.total / v.c : 0,
        };
      });
    }

    return c.json({
      period,
      start: startIso,
      end: endIso,
      totals: {
        totalSales,
        totalTransactions,
        avgTransactionValue,
        totalProfit,
        totalExpenses,
        netProfit,
        itemsWithoutCost,
      },
      paymentBreakdown: {
        totals: paymentTotals,
        counts: paymentCounts,
      },
      salesData: series,
      topProducts: Array.isArray(s.top_products) ? s.top_products : s.top_products ?? [],
      topProductsAll: Array.isArray(s.top_products_all) ? s.top_products_all : s.top_products_all ?? [],
      topProfitProducts: Array.isArray(s.top_profit_products) ? s.top_profit_products : s.top_profit_products ?? [],
      profitProductsAll: Array.isArray(s.profit_products_all) ? s.profit_products_all : s.profit_products_all ?? [],
      bottomProducts: Array.isArray(s.bottom_products) ? s.bottom_products : s.bottom_products ?? [],
      topProfitExcludedWithoutCost: itemsWithoutCost,
    });
  });

