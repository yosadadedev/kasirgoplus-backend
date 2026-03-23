import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import type { HonoVariables } from "../context";

const CategoryCreateSchema = z.object({
  name: z.string().min(1),
  isVisible: z.boolean().optional(),
  icon: z.string().min(1).optional(),
  priority: z.number().int().optional(),
});

const CategoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  isVisible: z.boolean().optional(),
  icon: z.string().min(1).nullable().optional(),
  priority: z.number().int().optional(),
});

export const categoriesRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", requirePermission("canManageCategories"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const rows = (await sql`
      SELECT id, name, is_visible, icon, priority, created_at, updated_at
      FROM categories
      WHERE tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      ORDER BY priority DESC, name ASC
    `) as unknown as {
      id: string;
      name: string;
      is_visible: boolean;
      icon: string | null;
      priority: number;
      created_at: string;
      updated_at: string;
    }[];
    return c.json({
      categories: rows.map((r) => ({
        id: r.id,
        name: r.name,
        isVisible: r.is_visible,
        icon: r.icon,
        priority: r.priority,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  })
  .post("/", requirePermission("canManageCategories"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = CategoryCreateSchema.parse(await c.req.json());
    const rows = (await sql`
      INSERT INTO categories (tenant_id, name, is_visible, icon, priority, created_by, updated_by, updated_seq)
      VALUES (
        ${authUser.tenantId},
        ${input.name},
        ${input.isVisible ?? true},
        ${input.icon ?? null},
        ${input.priority ?? 0},
        ${authUser.id},
        ${authUser.id},
        1
      )
      RETURNING id, name, is_visible, icon, priority, created_at, updated_at
    `) as unknown as {
      id: string;
      name: string;
      is_visible: boolean;
      icon: string | null;
      priority: number;
      created_at: string;
      updated_at: string;
    }[];
    const r = rows[0]!;
    return c.json(
      {
        category: {
          id: r.id,
          name: r.name,
          isVisible: r.is_visible,
          icon: r.icon,
          priority: r.priority,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      },
      201,
    );
  })
  .patch("/:id", requirePermission("canManageCategories"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    const input = CategoryUpdateSchema.parse(await c.req.json());
    const rows = (await sql`
      UPDATE categories
      SET
        name = COALESCE(${input.name ?? null}, name),
        is_visible = COALESCE(${typeof input.isVisible === "boolean" ? input.isVisible : null}, is_visible),
        icon = COALESCE(${input.icon ?? null}, icon),
        priority = COALESCE(${input.priority ?? null}, priority),
        updated_by = ${authUser.id},
        updated_seq = updated_seq + 1,
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      RETURNING id, name, is_visible, icon, priority, created_at, updated_at
    `) as unknown as {
      id: string;
      name: string;
      is_visible: boolean;
      icon: string | null;
      priority: number;
      created_at: string;
      updated_at: string;
    }[];
    const r = rows[0];
    if (!r) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({
      category: {
        id: r.id,
        name: r.name,
        isVisible: r.is_visible,
        icon: r.icon,
        priority: r.priority,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  })
  .delete("/:id", requirePermission("canManageCategories"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    const rows = (await sql`
      UPDATE categories
      SET deleted_at = now(), updated_at = now(), updated_by = ${authUser.id}, updated_seq = updated_seq + 1
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      RETURNING id
    `) as unknown as { id: string }[];
    if (!rows[0]) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });
