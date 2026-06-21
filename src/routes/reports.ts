import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import type { HonoVariables } from "../context";

const PaymentMethodSchema = z.enum(["cash", "qris", "transfer", "kasbon"]);
const FilterTypeSchema = z.enum(["all", "edited", "deleted"]);

const ReportsTransactionsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  cursor: z.string().optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  filterType: FilterTypeSchema.optional().default("all"),
});

type TransactionRow = {
  id: string;
  items: any;
  total: number | string;
  tax: number | string;
  discount: number | string;
  payment_method: string;
  customer_name: string | null;
  customer_phone: string | null;
  cash_received: number | string | null;
  change: number | string | null;
  cashier: string | null;
  timestamp: string;
  is_edited: boolean;
  notes: string | null;
  sequence_number: string | null;
  table_number: string | null;
  deleted_at: string | null;
};

type ExpenseRow = {
  id: string;
  amount: number | string;
  category: string;
  description: string | null;
  date: string;
  created_at: string;
  deleted_at: string | null;
};

const parseCursor = (cursor?: string) => {
  if (!cursor) return null;
  const sepIndex = cursor.indexOf("|");
  if (sepIndex <= 0 || sepIndex >= cursor.length - 1) {
    throw new Error("INVALID_CURSOR");
  }

  const timestamp = cursor.slice(0, sepIndex);
  const id = cursor.slice(sepIndex + 1);
  if (Number.isNaN(Date.parse(timestamp)) || !id) {
    throw new Error("INVALID_CURSOR");
  }

  return { timestamp, id };
};

const toTransactionDto = (row: TransactionRow) => ({
  id: row.id,
  items: row.items ?? [],
  total: Number(row.total ?? 0),
  tax: Number(row.tax ?? 0),
  discount: Number(row.discount ?? 0),
  payment_method: row.payment_method,
  customer_name: row.customer_name ?? null,
  customer_phone: row.customer_phone ?? null,
  cash_received: row.cash_received == null ? null : Number(row.cash_received),
  change: row.change == null ? null : Number(row.change),
  cashier: row.cashier ?? null,
  timestamp: row.timestamp,
  is_edited: Boolean(row.is_edited),
  notes: row.notes ?? null,
  sequence_number: row.sequence_number ?? null,
  table_number: row.table_number ?? null,
  deleted_at: row.deleted_at ?? null,
});

const toExpenseDto = (row: ExpenseRow) => ({
  id: row.id,
  amount: Number(row.amount ?? 0),
  category: row.category,
  description: row.description ?? null,
  date: row.date,
  created_at: row.created_at,
  deleted_at: row.deleted_at ?? null,
});

const buildTransactionWhere = (input: z.infer<typeof ReportsTransactionsQuerySchema>, tenantId: string) => {
  const cursor = parseCursor(input.cursor);
  const where: string[] = ["tenant_id = $1", "timestamp >= $2", "timestamp <= $3"];
  const params: any[] = [tenantId, input.from, input.to];

  if (input.filterType === "deleted") {
    where.push("deleted_at IS NOT NULL");
  } else {
    where.push("deleted_at IS NULL");
    if (input.filterType === "edited") {
      where.push("is_edited = true");
    }
  }

  if (input.paymentMethod) {
    where.push(`payment_method = $${params.length + 1}`);
    params.push(input.paymentMethod);
  }

  if (cursor) {
    const tsIndex = params.length + 1;
    const idIndex = params.length + 2;
    where.push(`(timestamp < $${tsIndex} OR (timestamp = $${tsIndex} AND id < $${idIndex}))`);
    params.push(cursor.timestamp, cursor.id);
  }

  return { where, params };
};

const buildExpenseWhere = (input: z.infer<typeof ReportsTransactionsQuerySchema>, tenantId: string) => {
  const cursor = parseCursor(input.cursor);
  const where: string[] = ["tenant_id = $1", "date >= $2", "date <= $3"];
  const params: any[] = [tenantId, input.from, input.to];

  if (input.filterType === "deleted") {
    where.push("deleted_at IS NOT NULL");
  } else {
    where.push("deleted_at IS NULL");
  }

  if (cursor) {
    const dateIndex = params.length + 1;
    const idIndex = params.length + 2;
    where.push(`(date < $${dateIndex} OR (date = $${dateIndex} AND id < $${idIndex}))`);
    params.push(cursor.timestamp, cursor.id);
  }

  return { where, params };
};

export const reportsRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/transactions", requirePermission("canViewReports"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = ReportsTransactionsQuerySchema.parse(c.req.query());
    const { where, params } = buildTransactionWhere(input, authUser.tenantId);
    const limitIndex = params.length + 1;

    const rows = await sql.unsafe<TransactionRow[]>(
      `
        SELECT
          id,
          items,
          total,
          tax,
          discount,
          payment_method,
          customer_name,
          customer_phone,
          cash_received,
          change,
          cashier,
          timestamp,
          is_edited,
          notes,
          sequence_number,
          table_number,
          deleted_at
        FROM transactions
        WHERE ${where.join(" AND ")}
        ORDER BY timestamp DESC, id DESC
        LIMIT $${limitIndex}
      `,
      [...params, input.limit],
    );

    const items = rows.map(toTransactionDto);
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === input.limit && last ? `${last.timestamp}|${last.id}` : null;

    return c.json({ items, nextCursor });
  })
  .get("/transactions/count", requirePermission("canViewReports"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = ReportsTransactionsQuerySchema.omit({ limit: true, cursor: true }).parse(c.req.query());
    const { where, params } = buildTransactionWhere({ ...input, limit: 200 }, authUser.tenantId);

    const rows = await sql.unsafe<{ c: string | number }[]>(
      `
        SELECT COUNT(*) AS c
        FROM transactions
        WHERE ${where.join(" AND ")}
      `,
      params,
    );

    return c.json({ count: Number(rows[0]?.c ?? 0) });
  })
  .get("/expenses", requirePermission("canAddExpenses"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = ReportsTransactionsQuerySchema.parse(c.req.query());
    const { where, params } = buildExpenseWhere(input, authUser.tenantId);
    const limitIndex = params.length + 1;

    const rows = await sql.unsafe<ExpenseRow[]>(
      `
        SELECT
          id,
          amount,
          category,
          description,
          date,
          created_at,
          deleted_at
        FROM expenses
        WHERE ${where.join(" AND ")}
        ORDER BY date DESC, id DESC
        LIMIT $${limitIndex}
      `,
      [...params, input.limit],
    );

    const items = rows.map(toExpenseDto);
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === input.limit && last ? `${last.date}|${last.id}` : null;

    return c.json({ items, nextCursor });
  });
