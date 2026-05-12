import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";

const QuerySchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().min(1).max(500).optional()),
});

const normalizeJson = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
};

const parseCursor = (raw: string | undefined) => {
  if (!raw) return null;
  const s = String(raw);
  if (s.includes("|")) {
    const [tsRaw, idRaw] = s.split("|");
    const ts = new Date(tsRaw);
    const id = String(idRaw ?? "");
    if (!Number.isFinite(ts.getTime()) || !id) return null;
    return { ts, id };
  }
  const ts = new Date(s);
  if (!Number.isFinite(ts.getTime())) return null;
  return { ts, id: "" };
};

export const transactionsRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    const query = QuerySchema.parse(c.req.query());
    const limit = query.limit ?? 200;
    const start = new Date(query.start);
    const end = new Date(query.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      return c.json({ error: "VALIDATION_ERROR", issues: [{ path: ["start", "end"], message: "Invalid date" }] }, 400);
    }
    const cursor = parseCursor(query.cursor);
    if (query.cursor && !cursor) {
      return c.json({ error: "VALIDATION_ERROR", issues: [{ path: ["cursor"], message: "Invalid cursor" }] }, 400);
    }

    const rows = (await sql`
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
        created_at,
        updated_at
      FROM transactions
      WHERE tenant_id = ${authUser.tenantId}
        AND deleted_at IS NULL
        AND timestamp >= ${start.toISOString()}
        AND timestamp <= ${end.toISOString()}
        ${
          cursor
            ? cursor.id
              ? sql`AND (timestamp < ${cursor.ts.toISOString()} OR (timestamp = ${cursor.ts.toISOString()} AND id < ${cursor.id}))`
              : sql`AND timestamp < ${cursor.ts.toISOString()}`
            : sql``
        }
      ORDER BY timestamp DESC, id DESC
      LIMIT ${limit}
    `) as unknown as {
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
      created_at: string;
      updated_at: string;
    }[];

    const nextCursor =
      rows.length === limit && rows[rows.length - 1]
        ? `${new Date(rows[rows.length - 1]!.timestamp).toISOString()}|${String(rows[rows.length - 1]!.id)}`
        : null;

    return c.json({
      transactions: rows.map((r) => ({
        id: String(r.id),
        items: (normalizeJson(r.items) as any) ?? [],
        total: Number(r.total) || 0,
        tax: Number(r.tax) || 0,
        discount: Number(r.discount) || 0,
        paymentMethod: r.payment_method,
        customerName: r.customer_name ?? undefined,
        customerPhone: r.customer_phone ?? undefined,
        cashReceived: r.cash_received == null ? undefined : Number(r.cash_received) || 0,
        change: r.change == null ? undefined : Number(r.change) || 0,
        cashier: r.cashier ?? undefined,
        timestamp: r.timestamp,
        isEdited: Boolean(r.is_edited),
        notes: r.notes ?? undefined,
        sequenceNumber: r.sequence_number ?? undefined,
        tableNumber: r.table_number ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      nextCursor,
    });
  });
