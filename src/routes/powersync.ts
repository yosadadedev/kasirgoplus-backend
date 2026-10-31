import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { sql } from "../db";

const OpSchema = z.object({
  op: z.enum(["PUT", "PATCH", "DELETE"]),
  table: z.enum([
    "categories",
    "products",
    "transactions",
    "expenses",
    "customers",
    "discounts",
    "stock_movements",
  ]),
  id: z.string(),
  data: z.record(z.any()).optional(),
});

const UploadSchema = z.object({
  crud: z.array(OpSchema),
});

const allowedColumns: Record<string, Set<string>> = {
  categories: new Set([
    "id",
    "tenant_id",
    "name",
    "is_visible",
    "icon",
    "priority",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
  products: new Set([
    "id",
    "tenant_id",
    "name",
    "price",
    "wholesale_price",
    "category_id",
    "stock",
    "min_stock",
    "unit",
    "unit_type",
    "base_unit",
    "unit_multiplier",
    "image",
    "barcode",
    "description",
    "variants",
    "track_cost",
    "cost",
    "priority",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
  transactions: new Set([
    "id",
    "tenant_id",
    "items",
    "total",
    "tax",
    "discount",
    "payment_method",
    "customer_name",
    "customer_phone",
    "cash_received",
    "change",
    "cashier",
    "timestamp",
    "is_backdated",
    "is_edited",
    "notes",
    "sequence_number",
    "table_number",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
  expenses: new Set([
    "id",
    "tenant_id",
    "amount",
    "category",
    "description",
    "date",
    "type",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
  customers: new Set([
    "id",
    "tenant_id",
    "name",
    "email",
    "phone",
    "address",
    "city",
    "date_of_birth",
    "gender",
    "is_active",
    "total_purchases",
    "total_spent",
    "last_purchase_date",
    "loyalty_points",
    "customer_type",
    "notes",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
  discounts: new Set([
    "id",
    "tenant_id",
    "name",
    "type",
    "value",
    "is_active",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
  stock_movements: new Set([
    "id",
    "tenant_id",
    "product_id",
    "type",
    "quantity_change",
    "stock_before",
    "stock_after",
    "note",
    "reference_id",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
};

const booleanColumns: Record<string, Set<string>> = {
  categories: new Set(["is_visible"]),
  products: new Set(["track_cost"]),
  transactions: new Set(["is_backdated", "is_edited"]),
  expenses: new Set([]),
  customers: new Set(["is_active"]),
  discounts: new Set(["is_active"]),
};

const jsonColumns: Record<string, Set<string>> = {
  categories: new Set([]),
  products: new Set(["variants"]),
  transactions: new Set(["items"]),
  expenses: new Set([]),
  customers: new Set([]),
};

// Kolom bigint/int di Postgres. Mobile (SQLite) bisa mengirim angka desimal, misalnya
// diskon persen 10% x 39998 = 3999.8, yang ditolak Postgres dan membuat antrean upload macet.
const integerColumns: Record<string, Set<string>> = {
  categories: new Set(["priority"]),
  products: new Set(["price", "wholesale_price", "stock", "min_stock", "unit_multiplier", "cost", "priority"]),
  transactions: new Set(["total", "tax", "discount", "cash_received", "change"]),
  expenses: new Set(["amount"]),
  customers: new Set(["total_purchases", "total_spent", "loyalty_points"]),
  discounts: new Set(["value"]),
  stock_movements: new Set(["quantity_change", "stock_before", "stock_after"]),
};

// Subset of integerColumns that are int4 (not bigint) in Postgres. A value past int4 range makes the
// whole batch fail with 22003 and get discarded, and a checkout batch also carries the sale itself,
// so clamp instead: an off stock count is recoverable, a lost transaction is not.
const INT4_MAX = 2_147_483_647;
const INT4_MIN = -2_147_483_648;
const int4Columns: Record<string, Set<string>> = {
  categories: new Set(["priority"]),
  products: new Set(["stock", "min_stock", "unit_multiplier", "priority"]),
  customers: new Set(["total_purchases", "loyalty_points"]),
  stock_movements: new Set(["quantity_change", "stock_before", "stock_after"]),
};

const clampInt4 = (table: string, col: string, value: number) => {
  if (!int4Columns[table]?.has(col)) return value;
  if (value > INT4_MAX || value < INT4_MIN) {
    console.warn("[powersync.upload] clamped int4 value", { table, col, value });
    return Math.min(INT4_MAX, Math.max(INT4_MIN, value));
  }
  return value;
};

const normalizeValue = (table: string, col: string, value: any) => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (integerColumns[table]?.has(col)) {
    if (typeof value === "number" && Number.isFinite(value)) return clampInt4(table, col, Math.round(value));
    if (typeof value === "string" && /^-?\d+\.\d+$/.test(value.trim())) return clampInt4(table, col, Math.round(Number(value)));
    if (typeof value === "string" && /^-?\d+$/.test(value.trim()) && int4Columns[table]?.has(col)) {
      return clampInt4(table, col, Number(value));
    }
  }

  if (booleanColumns[table]?.has(col)) {
    if (value === 1) return true;
    if (value === 0) return false;
    if (typeof value === "boolean") return value;
  }

  if (jsonColumns[table]?.has(col)) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
  }

  return value;
};

const pickAllowed = (table: string, data: Record<string, any>) => {
  const allowed = allowedColumns[table];
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!allowed.has(k)) continue;
    const nv = normalizeValue(table, k, v);
    if (nv === undefined) continue;
    out[k] = nv;
  }
  return out;
};

export const powersyncRoutes = new Hono();

powersyncRoutes.use("*", requireAuth);

powersyncRoutes.post("/upload", async (c: any) => {
  const authUser = c.get("authUser")!;
  const body = UploadSchema.parse(await c.req.json());
  const tenantId = authUser.tenantId;
  const debug = Bun.env.POWERSYNC_DEBUG === "1";

  if (debug) {
    const summary: Record<string, number> = {};
    for (const op of body.crud) {
      const key = `${op.op}:${op.table}`;
      summary[key] = (summary[key] ?? 0) + 1;
    }
    console.info("[powersync.upload]", { tenantId, ops: body.crud.length, summary });
  }

  let currentOp: (typeof body.crud)[number] | null = null;
  try {
    await sql.begin(async (tx) => {
    for (const op of body.crud) {
      currentOp = op;
      const table = op.table;
      // sync_recent_mobile is maintained by a DB trigger (migration 020).
      const data = pickAllowed(table, op.data ?? {});
      const canonicalId = op.id;
      data.id = canonicalId;
      data.tenant_id = tenantId;

      if (op.op === "DELETE") {
        await tx.unsafe(`DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2`, [op.id, tenantId]);
        continue;
      }

      if (op.op === "PUT") {
        const cols = Object.keys(data);
        const vals = Object.values(data);
        if (cols.length === 0) continue;
        const colSql = cols.map((k) => `"${k}"`).join(", ");
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
        const updates = cols
          .filter((k) => k !== "id" && k !== "tenant_id")
          .map((k) => `"${k}" = EXCLUDED."${k}"`)
          .join(", ");

        await tx.unsafe(
          `INSERT INTO ${table} (${colSql}) VALUES (${placeholders})
           ON CONFLICT (id) DO UPDATE SET ${updates}
           WHERE ${table}.updated_seq IS NULL OR EXCLUDED.updated_seq IS NULL OR ${table}.updated_seq <= EXCLUDED.updated_seq`,
          vals,
        );
        continue;
      }

      if (op.op === "PATCH") {
        const cols = Object.keys(data).filter((k) => k !== "id" && k !== "tenant_id");
        if (cols.length === 0) continue;
        const vals = cols.map((k) => data[k]);
        const sets = cols.map((k, i) => `"${k}" = $${i + 1}`).join(", ");

        // Similar check for PATCH
        const seqIndex = cols.indexOf("updated_seq");
        const whereClause = seqIndex !== -1
          ? `AND (updated_seq IS NULL OR updated_seq <= $${seqIndex + 1})`
          : "";

        vals.push(op.id, tenantId);
        await tx.unsafe(
          `UPDATE ${table} SET ${sets} WHERE id = $${cols.length + 1} AND tenant_id = $${cols.length + 2} ${whereClause}`,
          vals,
        );
        continue;
      }
    }
    });
  } catch (e: any) {
    // Postgres class 23 = integrity constraint violation (unique, FK, NOT NULL, CHECK, ...),
    // class 22 = data exception (e.g. 22003 integer out of range, 22P02 invalid input).
    // Retrying the same batch will never succeed, so surface it as a conflict instead of 500,
    // otherwise the device retries forever and its whole upload queue stalls.
    if (typeof e?.code === "string" && (e.code.startsWith("23") || e.code.startsWith("22"))) {
      const failedOp = currentOp as (typeof body.crud)[number] | null;
      console.warn("[powersync.upload] rejected batch", {
        tenantId,
        actorUserId: authUser.id,
        code: e.code,
        message: e?.message,
        op: failedOp?.op,
        table: failedOp?.table,
        recordId: failedOp?.id,
        // Full batch so a discarded sale can still be recovered by hand from the logs.
        crud: JSON.stringify(body.crud),
      });
      return c.json(
        {
          error: "CONSTRAINT_VIOLATION",
          code: e.code,
          constraint: e?.constraint_name,
          table: e?.table_name ?? failedOp?.table,
        },
        409,
      );
    }
    throw e;
  }

  return c.json({ ok: true });
});
