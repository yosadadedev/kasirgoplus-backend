import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import type { HonoVariables } from "../context";

const UnitTypeSchema = z.enum(["piece", "weight", "volume"]);

const ProductCreateSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  stock: z.number().int().optional(),
  minStock: z.number().int().nullable().optional(),
  unit: z.string().min(1).nullable().optional(),
  unitType: UnitTypeSchema.optional(),
  baseUnit: z.string().min(1).optional(),
  unitMultiplier: z.number().int().positive().optional(),
  image: z.string().min(1).nullable().optional(),
  barcode: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  variants: z.any().optional(),
  trackCost: z.boolean().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  priority: z.number().int().optional(),
});

const ProductUpdateSchema = ProductCreateSchema.partial();

const normalizeUnit = (input: {
  unit?: string | null;
  unitType?: z.infer<typeof UnitTypeSchema>;
  baseUnit?: string;
  unitMultiplier?: number;
}) => {
  const unitRaw = (input.unit ?? undefined)?.trim();
  const unitNorm = unitRaw?.toLowerCase();
  if (input.unitType && input.baseUnit && input.unitMultiplier) {
    return {
      unit: unitRaw,
      unitType: input.unitType,
      baseUnit: input.baseUnit,
      unitMultiplier: input.unitMultiplier,
    };
  }
  if (!unitNorm) {
    return { unit: unitRaw, unitType: "piece" as const, baseUnit: "pcs" as const, unitMultiplier: 1 };
  }
  if (unitNorm === "kg" || unitNorm === "kilo" || unitNorm === "kilogram") {
    return { unit: "kg", unitType: "weight" as const, baseUnit: "g" as const, unitMultiplier: 1000 };
  }
  if (unitNorm === "g" || unitNorm === "gram") {
    return { unit: "g", unitType: "weight" as const, baseUnit: "g" as const, unitMultiplier: 1 };
  }
  if (unitNorm === "l" || unitNorm === "liter" || unitNorm === "litre") {
    return { unit: "l", unitType: "volume" as const, baseUnit: "ml" as const, unitMultiplier: 1000 };
  }
  if (unitNorm === "ml") {
    return { unit: "ml", unitType: "volume" as const, baseUnit: "ml" as const, unitMultiplier: 1 };
  }
  if (unitNorm === "pcs" || unitNorm === "pc" || unitNorm === "piece" || unitNorm === "buah") {
    return { unit: "pcs", unitType: "piece" as const, baseUnit: "pcs" as const, unitMultiplier: 1 };
  }
  return { unit: unitRaw, unitType: "piece" as const, baseUnit: "pcs" as const, unitMultiplier: 1 };
};

export const productsRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", requirePermission("canManageProducts"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const rows = (await sql`
      SELECT
        id,
        name,
        price,
        wholesale_price,
        category_id,
        stock,
        min_stock,
        unit,
        unit_type,
        base_unit,
        unit_multiplier,
        image,
        barcode,
        description,
        variants,
        track_cost,
        cost,
        priority,
        is_deleted,
        created_at,
        updated_at
      FROM products
      WHERE tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      ORDER BY priority DESC, name ASC
    `) as unknown as any[];
    return c.json({
      products: rows.map((r) => ({
        id: r.id,
        name: r.name,
        price: Number(r.price ?? 0),
        wholesalePrice: r.wholesale_price == null ? undefined : Number(r.wholesale_price),
        categoryId: r.category_id,
        stock: Number(r.stock ?? 0),
        minStock: r.min_stock == null ? undefined : Number(r.min_stock),
        unit: r.unit ?? undefined,
        unitType: r.unit_type ?? "piece",
        baseUnit: r.base_unit ?? "pcs",
        unitMultiplier: Number(r.unit_multiplier ?? 1),
        image: r.image ?? undefined,
        barcode: r.barcode ?? undefined,
        description: r.description ?? undefined,
        variants: r.variants ?? undefined,
        trackCost: Boolean(r.track_cost),
        cost: r.cost == null ? undefined : Number(r.cost),
        priority: Number(r.priority ?? 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  })
  .post("/", requirePermission("canManageProducts"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = ProductCreateSchema.parse(await c.req.json());
    const unitInfo = normalizeUnit(input);
    const rows = (await sql`
      INSERT INTO products (
        tenant_id,
        name,
        price,
        wholesale_price,
        category_id,
        stock,
        min_stock,
        unit,
        unit_type,
        base_unit,
        unit_multiplier,
        image,
        barcode,
        description,
        variants,
        track_cost,
        cost,
        priority,
        created_by,
        updated_by,
        updated_seq
      )
      VALUES (
        ${authUser.tenantId},
        ${input.name},
        ${Math.round(input.price ?? 0)},
        ${input.wholesalePrice == null ? null : Math.round(input.wholesalePrice)},
        ${input.categoryId ?? null},
        ${input.stock ?? 0},
        ${input.minStock ?? null},
        ${unitInfo.unit ?? null},
        ${unitInfo.unitType},
        ${unitInfo.baseUnit},
        ${unitInfo.unitMultiplier},
        ${input.image ?? null},
        ${input.barcode ?? null},
        ${input.description ?? null},
        ${input.variants ? sql.json(input.variants) : null},
        ${input.trackCost ?? false},
        ${input.cost == null ? null : Math.round(input.cost)},
        ${input.priority ?? 0},
        ${authUser.id},
        ${authUser.id},
        1
      )
      RETURNING *
    `) as unknown as any[];
    const r = rows[0]!;
    return c.json(
      {
        product: {
          id: r.id,
          name: r.name,
          price: Number(r.price ?? 0),
          wholesalePrice: r.wholesale_price == null ? undefined : Number(r.wholesale_price),
          categoryId: r.category_id,
          stock: Number(r.stock ?? 0),
          minStock: r.min_stock == null ? undefined : Number(r.min_stock),
          unit: r.unit ?? undefined,
          image: r.image ?? undefined,
          barcode: r.barcode ?? undefined,
          description: r.description ?? undefined,
          variants: r.variants ?? undefined,
          trackCost: Boolean(r.track_cost),
          cost: r.cost == null ? undefined : Number(r.cost),
          priority: Number(r.priority ?? 0),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      },
      201,
    );
  })
  .patch("/:id", requirePermission("canManageProducts"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    const input = ProductUpdateSchema.parse(await c.req.json());
    const unitInfo = normalizeUnit(input);

    const rows = (await sql`
      UPDATE products
      SET
        name = COALESCE(${input.name ?? null}, name),
        price = COALESCE(${input.price == null ? null : Math.round(input.price)}, price),
        wholesale_price = COALESCE(${input.wholesalePrice == null ? null : Math.round(input.wholesalePrice)}, wholesale_price),
        category_id = COALESCE(${input.categoryId ?? null}, category_id),
        stock = COALESCE(${input.stock ?? null}, stock),
        min_stock = COALESCE(${input.minStock ?? null}, min_stock),
        unit = COALESCE(${unitInfo.unit ?? null}, unit),
        unit_type = COALESCE(${unitInfo.unitType ?? null}, unit_type),
        base_unit = COALESCE(${unitInfo.baseUnit ?? null}, base_unit),
        unit_multiplier = COALESCE(${unitInfo.unitMultiplier ?? null}, unit_multiplier),
        image = COALESCE(${input.image ?? null}, image),
        barcode = COALESCE(${input.barcode ?? null}, barcode),
        description = COALESCE(${input.description ?? null}, description),
        variants = COALESCE(${input.variants ? sql.json(input.variants) : null}, variants),
        track_cost = COALESCE(${typeof input.trackCost === "boolean" ? input.trackCost : null}, track_cost),
        cost = COALESCE(${input.cost == null ? null : Math.round(input.cost)}, cost),
        priority = COALESCE(${input.priority ?? null}, priority),
        updated_by = ${authUser.id},
        updated_seq = updated_seq + 1,
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      RETURNING *
    `) as unknown as any[];
    const r = rows[0];
    if (!r) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({
      product: {
        id: r.id,
        name: r.name,
        price: Number(r.price ?? 0),
        wholesalePrice: r.wholesale_price == null ? undefined : Number(r.wholesale_price),
        categoryId: r.category_id,
        stock: Number(r.stock ?? 0),
        minStock: r.min_stock == null ? undefined : Number(r.min_stock),
        unit: r.unit ?? undefined,
        unitType: r.unit_type ?? "piece",
        baseUnit: r.base_unit ?? "pcs",
        unitMultiplier: Number(r.unit_multiplier ?? 1),
        image: r.image ?? undefined,
        barcode: r.barcode ?? undefined,
        description: r.description ?? undefined,
        variants: r.variants ?? undefined,
        trackCost: Boolean(r.track_cost),
        cost: r.cost == null ? undefined : Number(r.cost),
        priority: Number(r.priority ?? 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  })
  .delete("/:id", requirePermission("canManageProducts"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    const rows = (await sql`
      UPDATE products
      SET deleted_at = now(), updated_at = now(), updated_by = ${authUser.id}, updated_seq = updated_seq + 1
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      RETURNING id
    `) as unknown as { id: string }[];
    if (!rows[0]) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });
