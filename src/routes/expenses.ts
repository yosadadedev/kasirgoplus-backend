import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";

const QuerySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().min(1).max(1000).optional()),
});

export const expensesRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    const query = QuerySchema.parse(c.req.query());
    const limit = query.limit ?? 500;
    const start = query.start ? new Date(query.start) : null;
    const end = query.end ? new Date(query.end) : null;
    if (start && !Number.isFinite(start.getTime())) {
      return c.json({ error: "VALIDATION_ERROR", issues: [{ path: ["start"], message: "Invalid date" }] }, 400);
    }
    if (end && !Number.isFinite(end.getTime())) {
      return c.json({ error: "VALIDATION_ERROR", issues: [{ path: ["end"], message: "Invalid date" }] }, 400);
    }

    const rows = (await sql`
      SELECT
        id,
        amount,
        category,
        description,
        date,
        created_at,
        updated_at
      FROM expenses
      WHERE tenant_id = ${authUser.tenantId}
        AND deleted_at IS NULL
        ${start ? sql`AND date >= ${start.toISOString()}` : sql``}
        ${end ? sql`AND date <= ${end.toISOString()}` : sql``}
      ORDER BY date DESC
      LIMIT ${limit}
    `) as unknown as {
      id: string;
      amount: number | string;
      category: string;
      description: string | null;
      date: string;
      created_at: string;
      updated_at: string;
    }[];

    return c.json({
      expenses: rows.map((r) => ({
        id: String(r.id),
        amount: Number(r.amount) || 0,
        category: r.category,
        description: r.description ?? undefined,
        date: r.date,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

