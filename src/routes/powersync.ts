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
    "business_settings",
    "printer_settings",
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
  business_settings: new Set([
    "id",
    "tenant_id",
    "business_name",
    "business_address",
    "business_phone",
    "business_email",
    "business_city",
    "tax_rate",
    "currency",
    "logo",
    "loyalty_per_amount",
    "loyalty_base_amount",
    "loyalty_points_per_base",
    "loyalty_rounding_mode",
    "loyalty_point_value",
    "vip_loyalty_base_amount",
    "vip_loyalty_points_per_base",
    "wholesale_loyalty_base_amount",
    "wholesale_loyalty_points_per_base",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
    "updated_seq",
  ]),
  printer_settings: new Set([
    "id",
    "tenant_id",
    "printer_name",
    "printer_ip",
    "printer_port",
    "paper_size",
    "print_logo",
    "printer_logo",
    "print_customer_copy",
    "receipt_header",
    "receipt_footer",
    "show_tax",
    "show_payment_method",
    "show_watermark",
    "show_sequence_number",
    "show_table_number",
    "last_connected_device_address",
    "last_connected_device_name",
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
  customers: new Set(["is_active"]),
  discounts: new Set(["is_active"]),
  printer_settings: new Set([
    "print_logo",
    "print_customer_copy",
    "show_tax",
    "show_payment_method",
    "show_watermark",
    "show_sequence_number",
    "show_table_number",
  ]),
};

const jsonColumns: Record<string, Set<string>> = {
  categories: new Set([]),
  products: new Set(["variants"]),
  transactions: new Set(["items"]),
  expenses: new Set([]),
  customers: new Set([]),
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
  const debug = Bun.env.POWERSYNC_DEBUG === "1";

  if (debug) {
    const summary: Record<string, number> = {};
    for (const op of body.crud) {
      const key = `${op.op}:${op.table}`;
      summary[key] = (summary[key] ?? 0) + 1;
    }
    console.info("[powersync.upload]", { tenantId, ops: body.crud.length, summary });
  }

  await sql.begin(async (tx) => {
    for (const op of body.crud) {
      const table = op.table;
      const data = pickAllowed(table, op.data ?? {});
      const canonicalId =
        table === "business_settings"
          ? `business_${tenantId}`
          : table === "printer_settings"
            ? `printer_${tenantId}`
            : op.id;
      data.id = canonicalId;
      data.tenant_id = tenantId;

      if (op.op === "DELETE") {
        if (table === "business_settings" || table === "printer_settings") {
          await tx.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
        } else {
          await tx.unsafe(`DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2`, [op.id, tenantId]);
        }
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

        if (table === "business_settings" || table === "printer_settings") {
          const seqIndex = cols.indexOf("updated_seq");
          const seqValue = seqIndex !== -1 ? vals[seqIndex] : null;
          const updCols = cols.filter((k) => k !== "tenant_id");
          const updVals = updCols.map((k) => data[k]);
          updVals.push(tenantId);
          if (seqIndex !== -1) updVals.push(seqValue);
          const sets = updCols.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
          const whereClause = seqIndex !== -1 ? `AND (updated_seq IS NULL OR $${updCols.length + 2} IS NULL OR updated_seq <= $${updCols.length + 2})` : "";
          const updateResult = await tx.unsafe(
            `UPDATE ${table} SET ${sets} WHERE tenant_id = $${updCols.length + 1} AND deleted_at IS NULL ${whereClause}`,
            updVals,
          );

          const updatedCount = (updateResult as any).count ?? 0;
          if (updatedCount === 0) {
            await tx.unsafe(
              `INSERT INTO ${table} (${colSql}) VALUES (${placeholders})
               ON CONFLICT (id) DO UPDATE SET ${updates}
               WHERE ${table}.updated_seq IS NULL OR EXCLUDED.updated_seq IS NULL OR ${table}.updated_seq <= EXCLUDED.updated_seq`,
              vals,
            );
          }
        } else {
          await tx.unsafe(
            `INSERT INTO ${table} (${colSql}) VALUES (${placeholders})
             ON CONFLICT (id) DO UPDATE SET ${updates}
             WHERE ${table}.updated_seq IS NULL OR EXCLUDED.updated_seq IS NULL OR ${table}.updated_seq <= EXCLUDED.updated_seq`,
            vals,
          );
        }
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

        if (table === "business_settings" || table === "printer_settings") {
          vals.push(tenantId);
          await tx.unsafe(
            `UPDATE ${table} SET ${sets} WHERE tenant_id = $${cols.length + 1} AND deleted_at IS NULL ${whereClause}`,
            vals,
          );
        } else {
          vals.push(op.id, tenantId);
          await tx.unsafe(
            `UPDATE ${table} SET ${sets} WHERE id = $${cols.length + 1} AND tenant_id = $${cols.length + 2} ${whereClause}`,
            vals,
          );
        }
        continue;
      }
    }
  });

  return c.json({ ok: true });
});
