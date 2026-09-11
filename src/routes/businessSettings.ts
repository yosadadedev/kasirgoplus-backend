import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { env } from "../env";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";
import { deleteQrisImageFromR2, getQrisImageFromR2, uploadQrisImageToR2 } from "../services/r2";

const resolvePublicOrigin = (c: any) => {
  if (env.PUBLIC_API_BASE_URL) return env.PUBLIC_API_BASE_URL.replace(/\/$/, "");
  return new URL(c.req.url).origin;
};

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
    taxRate: z.number().min(0).max(100).optional(),
    qrisMerchantName: z.string().optional(),
    qrisActive: z.boolean().optional(),
  })
  .passthrough();

const mapBusinessRow = (r: any) => ({
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
  qrisImageUrl: r?.qris_image_url ?? undefined,
  qrisMerchantName: r?.qris_merchant_name ?? "",
  qrisActive: Boolean(r?.qris_active),
});

const QRIS_IMAGE_PROXY_PREFIX = "/v1/business-settings/qris-image/";

const getQrisImageKeyFromRequest = (requestUrl: string) => {
  const pathname = new URL(requestUrl).pathname;
  const prefixIndex = pathname.indexOf(QRIS_IMAGE_PROXY_PREFIX);
  if (prefixIndex < 0) {
    return "";
  }

  const rawKey = pathname.slice(prefixIndex + QRIS_IMAGE_PROXY_PREFIX.length);
  return decodeURIComponent(rawKey).trim();
};

export const businessSettingsQrisImagePublicRoutes = new Hono().on(
  ["GET", "HEAD"],
  "/qris-image/*",
  async (c: any) => {
    const imageKey = getQrisImageKeyFromRequest(c.req.url);
    if (!imageKey) {
      return c.json({ error: "INVALID_IMAGE_REFERENCE" }, 400);
    }

    try {
      const image = await getQrisImageFromR2(imageKey);
      return new Response(c.req.method === "HEAD" ? null : Buffer.from(image.body), {
        status: 200,
        headers: {
          "Content-Type": image.contentType,
          "Cache-Control": image.cacheControl,
        },
      });
    } catch (error: any) {
      const statusCode = error?.$metadata?.httpStatusCode;
      const message = error instanceof Error ? error.message : "IMAGE_FETCH_FAILED";
      if (message === "R2_NOT_CONFIGURED") {
        return c.json({ error: "R2_NOT_CONFIGURED" }, 503);
      }
      if (
        message === "INVALID_IMAGE_REFERENCE" ||
        message === "IMAGE_NOT_FOUND" ||
        statusCode === 404 ||
        error?.name === "NoSuchKey"
      ) {
        return c.json({ error: "IMAGE_NOT_FOUND" }, 404);
      }
      throw error;
    }
  },
);

const upsertBusinessSettings = async (
  tenantId: string,
  authUserId: string,
  patch: {
    businessName?: string;
    businessAddress?: string;
    businessPhone?: string;
    businessEmail?: string;
    businessCity?: string;
    operationalOpenTime?: string;
    operationalCloseTime?: string;
    taxRate?: number;
    qrisMerchantName?: string;
    qrisActive?: boolean;
  },
) => {
  const id = `business_${tenantId}`;
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
      tax_rate,
      qris_merchant_name,
      qris_active,
      updated_at,
      created_at,
      created_by,
      updated_by,
      updated_seq
    )
    VALUES (
      ${id},
      ${tenantId},
      ${patch.businessName ?? ""},
      ${patch.businessAddress ?? ""},
      ${patch.businessPhone ?? ""},
      ${patch.businessEmail ?? ""},
      ${patch.businessCity ?? ""},
      ${patch.operationalOpenTime ?? "00:00"},
      ${patch.operationalCloseTime ?? "23:59"},
      ${patch.taxRate != null ? Math.round(patch.taxRate) : 0},
      ${patch.qrisMerchantName ?? ""},
      ${patch.qrisActive ?? false},
      now(),
      now(),
      ${authUserId},
      ${authUserId},
      1
    )
    ON CONFLICT (id) DO UPDATE SET
      business_name = COALESCE(${patch.businessName ?? null}, business_settings.business_name),
      business_address = COALESCE(${patch.businessAddress ?? null}, business_settings.business_address),
      business_phone = COALESCE(${patch.businessPhone ?? null}, business_settings.business_phone),
      business_email = COALESCE(${patch.businessEmail ?? null}, business_settings.business_email),
      business_city = COALESCE(${patch.businessCity ?? null}, business_settings.business_city),
      operational_open_time = COALESCE(${patch.operationalOpenTime ?? null}, business_settings.operational_open_time),
      operational_close_time = COALESCE(${patch.operationalCloseTime ?? null}, business_settings.operational_close_time),
      tax_rate = COALESCE(${patch.taxRate != null ? Math.round(patch.taxRate) : null}, business_settings.tax_rate),
      qris_merchant_name = COALESCE(${patch.qrisMerchantName ?? null}, business_settings.qris_merchant_name),
      qris_active = COALESCE(${patch.qrisActive ?? null}, business_settings.qris_active),
      updated_at = now(),
      updated_by = ${authUserId},
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
      logo,
      qris_image_url,
      qris_merchant_name,
      qris_active
  `) as unknown as any[];
  return rows[0]!;
};

const upsertQrisImageUrl = async (tenantId: string, authUserId: string, imageUrl: string | null) => {
  const id = `business_${tenantId}`;
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
      tax_rate,
      qris_image_url,
      qris_merchant_name,
      qris_active,
      updated_at,
      created_at,
      created_by,
      updated_by,
      updated_seq
    )
    VALUES (
      ${id},
      ${tenantId},
      '',
      '',
      '',
      '',
      '',
      '00:00',
      '23:59',
      0,
      ${imageUrl},
      '',
      false,
      now(),
      now(),
      ${authUserId},
      ${authUserId},
      1
    )
    ON CONFLICT (id) DO UPDATE SET
      qris_image_url = ${imageUrl},
      updated_at = now(),
      updated_by = ${authUserId},
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
      logo,
      qris_image_url,
      qris_merchant_name,
      qris_active
  `) as unknown as any[];
  return rows[0]!;
};

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
        qris_image_url,
        qris_merchant_name,
        qris_active,
        updated_at
      FROM business_settings
      WHERE tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `) as unknown as any[];
    return c.json({ business: mapBusinessRow(rows[0]) });
  })
  .patch("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    if (authUser.role === "cashier") return c.json({ error: "FORBIDDEN" }, 403);
    const input = UpdateBusinessSettingsSchema.parse(await c.req.json());
    if (Object.keys(input).length === 0) return c.json({ error: "NO_CHANGES" }, 400);

    const r = await upsertBusinessSettings(authUser.tenantId, authUser.id, input);
    return c.json({ business: mapBusinessRow(r) });
  })
  .post("/upload-qris-image", async (c: any) => {
    const authUser = c.get("authUser")!;
    if (authUser.role === "cashier") return c.json({ error: "FORBIDDEN" }, 403);
    const body = await c.req.parseBody();
    const file = body.file;

    if (!(file instanceof File)) {
      return c.json({ error: "INVALID_FILE" }, 400);
    }

    try {
      const existingRows = (await sql`
        SELECT qris_image_url FROM business_settings
        WHERE tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
        LIMIT 1
      `) as unknown as any[];
      const previousImageUrl = existingRows[0]?.qris_image_url as string | null | undefined;

      const uploaded = await uploadQrisImageToR2({
        tenantId: authUser.tenantId,
        file,
      });
      const origin = resolvePublicOrigin(c);
      const imageUrl = `${origin}/v1/business-settings/qris-image/${uploaded.imageKey}`;

      const r = await upsertQrisImageUrl(authUser.tenantId, authUser.id, imageUrl);

      if (previousImageUrl && previousImageUrl !== imageUrl) {
        await deleteQrisImageFromR2({ imageUrl: previousImageUrl }).catch((err) => {
          console.error(
            `[qris] gagal hapus gambar lama tenant=${authUser.tenantId} url=${previousImageUrl}:`,
            err,
          );
        });
      }

      console.log(
        `[qris] upload berhasil tenant=${authUser.tenantId} user=${authUser.id} key=${uploaded.imageKey} url=${imageUrl}`,
      );
      return c.json({ business: mapBusinessRow(r) }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
      console.error(`[qris] upload gagal tenant=${authUser.tenantId} user=${authUser.id}:`, error);
      if (message === "R2_NOT_CONFIGURED") {
        return c.json({ error: "R2_NOT_CONFIGURED" }, 503);
      }
      if (message === "FILE_TOO_LARGE") {
        return c.json({ error: "FILE_TOO_LARGE" }, 413);
      }
      if (
        message === "INVALID_FILE" ||
        message === "EMPTY_FILE" ||
        message === "INVALID_IMAGE_TYPE"
      ) {
        return c.json({ error: message }, 400);
      }
      throw error;
    }
  })
  .post("/delete-qris-image", async (c: any) => {
    const authUser = c.get("authUser")!;
    if (authUser.role === "cashier") return c.json({ error: "FORBIDDEN" }, 403);

    const existingRows = (await sql`
      SELECT qris_image_url FROM business_settings
      WHERE tenant_id = ${authUser.tenantId} AND deleted_at IS NULL
      LIMIT 1
    `) as unknown as any[];
    const previousImageUrl = existingRows[0]?.qris_image_url as string | null | undefined;

    if (previousImageUrl) {
      await deleteQrisImageFromR2({ imageUrl: previousImageUrl }).catch((err) => {
        console.error(
          `[qris] gagal hapus gambar dari R2 tenant=${authUser.tenantId} url=${previousImageUrl}:`,
          err,
        );
      });
    }

    const r = await upsertQrisImageUrl(authUser.tenantId, authUser.id, null);
    console.log(
      `[qris] hapus gambar berhasil tenant=${authUser.tenantId} user=${authUser.id} previousUrl=${previousImageUrl ?? "-"}`,
    );
    return c.json({ business: mapBusinessRow(r) });
  });
