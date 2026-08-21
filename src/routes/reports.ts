import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import type { HonoVariables } from "../context";
import type { AuthUser } from "../context";

const PaymentMethodSchema = z.enum([
  "cash",
  "qris",
  "transfer",
  "kasbon",
  "gobiz",
  "shopee",
  "grab",
  "lainnya",
]);
const FilterTypeSchema = z.enum(["all", "edited", "deleted"]);

const StockMovementsQuerySchema = z.object({
  productId: z.string().min(1),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  cursor: z.string().optional(),
});

const ReportsTransactionsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  cursor: z.string().optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  filterType: FilterTypeSchema.optional().default("all"),
  userId: z.string().min(1).optional(),
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

type StockMovementRow = {
  id: string;
  product_id: string;
  type: string;
  quantity_change: number | string;
  stock_before: number | string;
  stock_after: number | string;
  note: string | null;
  reference_id: string | null;
  created_at: string;
  created_by: string | null;
  transaction_cashier: string | null;
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

const toStockMovementDto = (row: StockMovementRow) => ({
  id: row.id,
  product_id: row.product_id,
  type: row.type,
  quantity_change: Number(row.quantity_change ?? 0),
  stock_before: Number(row.stock_before ?? 0),
  stock_after: Number(row.stock_after ?? 0),
  note: row.note ?? null,
  reference_id: row.reference_id ?? null,
  created_at: row.created_at,
  created_by: row.created_by ?? null,
  transaction_cashier: row.transaction_cashier ?? null,
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

const buildTransactionWhere = (
  input: z.infer<typeof ReportsTransactionsQuerySchema>,
  authUser: AuthUser,
) => {
  const cursor = parseCursor(input.cursor);
  const where: string[] = ["tenant_id = $1", "timestamp >= $2", "timestamp <= $3"];
  const params: any[] = [authUser.tenantId, input.from, input.to];

  if (input.userId) {
    where.push(`created_by = $${params.length + 1}`);
    params.push(input.userId);
  }

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

const buildStockMovementWhere = (
  input: z.infer<typeof StockMovementsQuerySchema>,
  tenantId: string,
) => {
  const cursor = parseCursor(input.cursor);
  const where: string[] = [
    "sm.tenant_id = $1",
    "sm.product_id = $2",
    "sm.created_at >= $3",
    "sm.created_at <= $4",
    "sm.deleted_at IS NULL",
  ];
  const params: any[] = [tenantId, input.productId, input.from, input.to];

  if (cursor) {
    const tsIndex = params.length + 1;
    const idIndex = params.length + 2;
    where.push(`(sm.created_at < $${tsIndex} OR (sm.created_at = $${tsIndex} AND sm.id < $${idIndex}))`);
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
    const { where, params } = buildTransactionWhere(input, authUser);
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
    const { where, params } = buildTransactionWhere({ ...input, limit: 200 }, authUser);

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
  .get("/stock-movements", requirePermission("canManageProducts"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = StockMovementsQuerySchema.parse(c.req.query());
    const { where, params } = buildStockMovementWhere(input, authUser.tenantId);
    const limitIndex = params.length + 1;

    const rows = await sql.unsafe<StockMovementRow[]>(
      `
        SELECT
          sm.id,
          sm.product_id,
          sm.type,
          sm.quantity_change,
          sm.stock_before,
          sm.stock_after,
          sm.note,
          sm.reference_id,
          sm.created_at,
          sm.created_by,
          t.cashier AS transaction_cashier
        FROM stock_movements sm
        LEFT JOIN transactions t ON sm.reference_id = t.id AND t.tenant_id = sm.tenant_id
        WHERE ${where.join(" AND ")}
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT $${limitIndex}
      `,
      [...params, input.limit],
    );

    const items = rows.map(toStockMovementDto);
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === input.limit && last ? `${last.created_at}|${last.id}` : null;

    return c.json({ items, nextCursor });
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
