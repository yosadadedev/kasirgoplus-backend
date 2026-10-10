import { Hono } from "hono";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import type { HonoVariables } from "../context";
import type { AuthUser } from "../context";

type TransactionRow = {
  id: string;
  items: any;
};

const buildDeleteWhere = (id: string, authUser: AuthUser) => {
  const where: string[] = ["id = $1", "tenant_id = $2", "deleted_at IS NULL"];
  const params: any[] = [id, authUser.tenantId];

  if (authUser.role !== "owner") {
    where.push(`created_by = $${params.length + 1}`);
    params.push(authUser.id);
  }

  return { where, params };
};

const parseTransactionItems = (rawItems: unknown): any[] => {
  if (typeof rawItems === "string") {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return Array.isArray(rawItems) ? rawItems : [];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Manual cart items (ongkir, bungkus, ...) carry ids like "manual_xxx" and have no product row;
// passing them to the uuid `products.id` column made Postgres reject the whole delete.
const getItemProductId = (item: any): string | null => {
  if (item?.product?.isManual) return null;
  const rawProductId = item?.product?.id;
  if (rawProductId === undefined || rawProductId === null) return null;
  const productId = String(rawProductId).trim();
  return UUID_PATTERN.test(productId) ? productId : null;
};

const getItemQuantityBase = (item: any): number => {
  const rawQuantity = Number(item?.quantityBase ?? item?.quantity ?? 0);
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return 0;
  return rawQuantity;
};

export const transactionsRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .delete("/:id", requirePermission("canDeleteTransactions"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    const { where, params } = buildDeleteWhere(id, authUser);

    const deleted = await sql.begin(async (tx: any) => {
      const rows = (await tx.unsafe(
        `
          UPDATE transactions
          SET deleted_at = now(), updated_at = now(), updated_by = $${params.length + 1}, updated_seq = updated_seq + 1
          WHERE ${where.join(" AND ")}
          RETURNING id, items
        `,
        [...params, authUser.id],
      )) as TransactionRow[];

      const transaction = rows[0];
      if (!transaction) return null;

      const items = parseTransactionItems(transaction.items);
      for (const item of items) {
        const productId = getItemProductId(item);
        const quantityBase = getItemQuantityBase(item);
        if (!productId || quantityBase <= 0) {
          continue;
        }

        const updatedProducts = (await tx.unsafe(
          `
            UPDATE products
            SET stock = GREATEST(0, COALESCE(stock, 0) + $1), updated_at = now(), updated_by = $2, updated_seq = updated_seq + 1
            WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
              -- stock < 0 means unlimited stock; leave it alone (matches the app's local delete).
              AND COALESCE(stock, 0) >= 0
            RETURNING stock
          `,
          [quantityBase, authUser.id, productId, authUser.tenantId],
        )) as { stock: number }[];

        // Record the restore in Riwayat Stok, like the app's local delete does.
        const stockAfter = updatedProducts[0]?.stock;
        if (typeof stockAfter === "number") {
          await tx.unsafe(
            `
              INSERT INTO stock_movements (
                id, tenant_id, product_id, type, quantity_change, stock_before, stock_after,
                reference_id, created_by, updated_by
              ) VALUES (gen_random_uuid()::text, $1, $2, 'restore', $3, $4, $5, $6, $7, $7)
            `,
            [authUser.tenantId, productId, quantityBase, stockAfter - quantityBase, stockAfter, transaction.id, authUser.id],
          );
        }
      }

      return transaction;
    });

    if (!deleted) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }

    return c.json({ ok: true });
  })
  // Editing a transaction that is no longer on the device (older than the mobile sync
  // window): the app restores stock and writes the edited copy locally, so the server
  // only soft-deletes the original. Restoring stock here too would be overwritten by the
  // app's absolute stock upload (or counted twice).
  .post("/:id/supersede", requirePermission("canEditTransactions"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    const { where, params } = buildDeleteWhere(id, authUser);

    const rows = (await sql.unsafe(
      `
        UPDATE transactions
        SET deleted_at = now(), updated_at = now(), updated_by = $${params.length + 1}, updated_seq = updated_seq + 1
        WHERE ${where.join(" AND ")}
        RETURNING id
      `,
      [...params, authUser.id],
    )) as { id: string }[];

    if (rows.length === 0) {
      // A retry after a lost response finds the row already deleted; treat it as done so
      // the app can still save the edited copy instead of dropping the sale.
      const retried = (await sql`
        SELECT id FROM transactions
        WHERE id = ${id} AND tenant_id = ${authUser.tenantId} AND updated_by = ${authUser.id}
          AND deleted_at > now() - interval '5 minutes'
        LIMIT 1
      `) as unknown as { id: string }[];
      if (retried.length > 0) return c.json({ ok: true });
      return c.json({ error: "NOT_FOUND" }, 404);
    }

    return c.json({ ok: true });
  });
