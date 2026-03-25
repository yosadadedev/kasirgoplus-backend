import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { sql } from "../db";

const OpSchema = z.object({
  op: z.enum(["PUT", "PATCH", "DELETE"]),
  table: z.enum(["categories", "products", "transactions", "expenses"]),
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
  transactions: new Set(["is_edited"]),
  expenses: new Set([]),
};

const jsonColumns: Record<string, Set<string>> = {
  categories: new Set([]),
  products: new Set(["variants"]),
  transactions: new Set(["items"]),
  expenses: new Set([]),
};

const normalizeValue = (table: string, col: string, value: any) => {
  if (value === undefined) return undefined;
  if (value === null) return null;

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

  await sql.begin(async (tx) => {
    for (const op of body.crud) {
      const table = op.table;
      const data = pickAllowed(table, op.data ?? {});
      data.id = op.id;
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
           ON CONFLICT (id) DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"}`,
          vals
        );
        continue;
      }

      if (op.op === "PATCH") {
        const cols = Object.keys(data).filter((k) => k !== "id" && k !== "tenant_id");
        if (cols.length === 0) continue;
        const vals = cols.map((k) => data[k]);
        vals.push(op.id, tenantId);
        const sets = cols.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
        await tx.unsafe(
          `UPDATE ${table} SET ${sets} WHERE id = $${cols.length + 1} AND tenant_id = $${cols.length + 2}`,
          vals
        );
        continue;
      }
    }
  });

  return c.json({ ok: true });
});
