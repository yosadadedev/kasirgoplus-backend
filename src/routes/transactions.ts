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

const getItemProductId = (item: any): string | null => {
  const rawProductId = item?.product?.id;
  if (rawProductId === undefined || rawProductId === null) return null;
  const productId = String(rawProductId).trim();
  return productId || null;
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
          SET deleted_at = now(), updated_at = now(), updated_by = $${params.length + 1}, updated_seq = updated_seq + 1,
              last_mobile_mutation_at = now(), sync_recent_mobile = true
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

        await tx.unsafe(
          `
            UPDATE products
            SET stock = GREATEST(0, COALESCE(stock, 0) + $1), updated_at = now(), updated_by = $2, updated_seq = updated_seq + 1
            WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
          `,
          [quantityBase, authUser.id, productId, authUser.tenantId],
        );
      }

      return transaction;
    });

    if (!deleted) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }

    return c.json({ ok: true });
  });
