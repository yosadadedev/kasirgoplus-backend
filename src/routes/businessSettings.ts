import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";

const TimeHHmm = z.string().regex(/^\d{2}:\d{2}$/);

const UpdateBusinessSettingsSchema = z
  .object({
    businessName: z.string().min(1).optional(),
    businessAddress: z.string().min(1).optional(),
    businessPhone: z.string().min(1).optional(),
    businessEmail: z.string().email().optional(),
    businessCity: z.string().optional(),
    operationalOpenTime: TimeHHmm.optional(),
    operationalCloseTime: TimeHHmm.optional(),
  })
  .strict();

export const businessSettingsRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    const rows = (await sql`
      SELECT
        business_name,
        business_address,
        business_phone,
        business_email,
        business_city,
        operational_open_time,
        operational_close_time,
        tax_rate,
        currency,
        logo,
        updated_at
      FROM business_settings
      WHERE tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `) as unknown as any[];
    const r = rows[0];
    return c.json({
      business: {
        businessName: r?.business_name ?? "",
        businessAddress: r?.business_address ?? "",
        businessPhone: r?.business_phone ?? "",
        businessEmail: r?.business_email ?? "",
        businessCity: r?.business_city ?? "",
        operationalOpenTime: r?.operational_open_time ?? "00:00",
        operationalCloseTime: r?.operational_close_time ?? "23:59",
        taxRate: r?.tax_rate == null ? 0 : Number(r.tax_rate) || 0,
        currency: r?.currency ?? "IDR",
        logo: r?.logo ?? undefined,
      },
    });
  })
  .patch("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    if (authUser.role === "cashier") return c.json({ error: "FORBIDDEN" }, 403);
    const input = UpdateBusinessSettingsSchema.parse(await c.req.json());
    if (Object.keys(input).length === 0) return c.json({ error: "NO_CHANGES" }, 400);

    const id = `business_${authUser.tenantId}`;
    const rows = (await sql`
      INSERT INTO business_settings (
        id,
        tenant_id,
        business_name,
        business_address,
        business_phone,
        business_email,
        business_city,
        operational_open_time,
        operational_close_time,
        updated_at,
        created_at,
        created_by,
        updated_by,
        updated_seq
      )
      VALUES (
        ${id},
        ${authUser.tenantId},
        ${input.businessName ?? ""},
        ${input.businessAddress ?? ""},
        ${input.businessPhone ?? ""},
        ${input.businessEmail ?? ""},
        ${input.businessCity ?? ""},
        ${input.operationalOpenTime ?? "00:00"},
        ${input.operationalCloseTime ?? "23:59"},
        now(),
        now(),
        ${authUser.id},
        ${authUser.id},
        1
      )
      ON CONFLICT (id) DO UPDATE SET
        business_name = COALESCE(${input.businessName ?? null}, business_settings.business_name),
        business_address = COALESCE(${input.businessAddress ?? null}, business_settings.business_address),
        business_phone = COALESCE(${input.businessPhone ?? null}, business_settings.business_phone),
        business_email = COALESCE(${input.businessEmail ?? null}, business_settings.business_email),
        business_city = COALESCE(${input.businessCity ?? null}, business_settings.business_city),
        operational_open_time = COALESCE(${input.operationalOpenTime ?? null}, business_settings.operational_open_time),
        operational_close_time = COALESCE(${input.operationalCloseTime ?? null}, business_settings.operational_close_time),
        updated_at = now(),
        updated_by = ${authUser.id},
        updated_seq = business_settings.updated_seq + 1
      WHERE business_settings.deleted_at IS NULL
      RETURNING
        business_name,
        business_address,
        business_phone,
        business_email,
        business_city,
        operational_open_time,
        operational_close_time,
        tax_rate,
        currency,
        logo
    `) as unknown as any[];
    const r = rows[0]!;
    return c.json({
      business: {
        businessName: r.business_name ?? "",
        businessAddress: r.business_address ?? "",
        businessPhone: r.business_phone ?? "",
        businessEmail: r.business_email ?? "",
        businessCity: r.business_city ?? "",
        operationalOpenTime: r.operational_open_time ?? "00:00",
        operationalCloseTime: r.operational_close_time ?? "23:59",
        taxRate: r.tax_rate == null ? 0 : Number(r.tax_rate) || 0,
        currency: r.currency ?? "IDR",
        logo: r.logo ?? undefined,
      },
    });
  });
