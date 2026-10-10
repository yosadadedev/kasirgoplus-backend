import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import type { HonoVariables } from "../context";

// The app keeps only the recent expenses on the device (sync_recent_mobile), so edits and
// deletes of older entries go straight to the server through these routes. Recent ones
// still go through PowerSync uploads.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UpdateExpenseSchema = z
  .object({
    amount: z.number().int().nonnegative().optional(),
    category: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    date: z.string().datetime({ offset: true }).optional(),
    type: z.enum(["expense", "income"]).optional(),
  })
  .strict();

export const expensesRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .patch("/:id", requirePermission("canAddExpenses"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    if (!UUID_PATTERN.test(id)) return c.json({ error: "NOT_FOUND" }, 404);

    const input = UpdateExpenseSchema.parse(await c.req.json());
    const updates: Record<string, unknown> = {};
    if (input.amount !== undefined) updates.amount = input.amount;
    if (input.category !== undefined) updates.category = input.category;
    if (input.description !== undefined) updates.description = input.description || null;
    if (input.date !== undefined) updates.date = input.date;
    if (input.type !== undefined) updates.type = input.type;
    if (Object.keys(updates).length === 0) return c.json({ error: "NO_CHANGES" }, 400);

    const rows = (await sql`
      UPDATE expenses
      SET ${sql(updates)}, updated_at = now(), updated_by = ${authUser.id}, updated_seq = updated_seq + 1
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      RETURNING id
    `) as unknown as { id: string }[];

    if (rows.length === 0) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  })
  .delete("/:id", requirePermission("canAddExpenses"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    if (!UUID_PATTERN.test(id)) return c.json({ error: "NOT_FOUND" }, 404);

    const rows = (await sql`
      UPDATE expenses
      SET deleted_at = now(), updated_at = now(), updated_by = ${authUser.id}, updated_seq = updated_seq + 1
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      RETURNING id
    `) as unknown as { id: string }[];

    if (rows.length === 0) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });
