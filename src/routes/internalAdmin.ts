import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { env } from "../env";
import { hashSecret } from "../auth/password";

const ForceChangePasswordSchema = z
  .object({
    userId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    newPassword: z.string().trim().min(6),
    revokeSessions: z.boolean().optional().default(true),
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((input, ctx) => {
    const byUserId = Boolean(input.userId);
    const byTenantAndEmail = Boolean(input.tenantId && input.email);

    if (!byUserId && !byTenantAndEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Gunakan userId atau kombinasi tenantId + email.",
        path: ["userId"],
      });
    }

    if (byUserId && (input.tenantId || input.email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pakai salah satu metode identifikasi user saja.",
        path: ["userId"],
      });
    }

    if (!byUserId && (Boolean(input.tenantId) !== Boolean(input.email))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tenantId dan email harus dikirim bersamaan.",
        path: ["tenantId"],
      });
    }
  });

const getInternalSecret = (headerValue?: string | null) => {
  const direct = (headerValue || "").trim();
  if (direct) return direct;
  return null;
};

export const internalAdminRoutes = new Hono().post("/users/force-password", async (c: any) => {
  if (!env.INTERNAL_ADMIN_SECRET) {
    return c.json({ error: "INTERNAL_ADMIN_DISABLED" }, 503);
  }

  const providedSecret = getInternalSecret(c.req.header("x-internal-admin-secret"));
  if (!providedSecret || providedSecret !== env.INTERNAL_ADMIN_SECRET) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }

  const input = ForceChangePasswordSchema.parse(await c.req.json());
  const nextPasswordHash = await hashSecret(input.newPassword);

  const targetRows = input.userId
    ? ((await sql`
        SELECT id, tenant_id, email, name, role, status
        FROM users
        WHERE id = ${input.userId}
        LIMIT 1
      `) as unknown as {
        id: string;
        tenant_id: string;
        email: string;
        name: string;
        role: string;
        status: string;
      }[])
    : ((await sql`
        SELECT id, tenant_id, email, name, role, status
        FROM users
        WHERE tenant_id = ${input.tenantId!} AND lower(email) = ${input.email!.trim().toLowerCase()}
        LIMIT 1
      `) as unknown as {
        id: string;
        tenant_id: string;
        email: string;
        name: string;
        role: string;
        status: string;
      }[]);

  const target = targetRows[0];
  if (!target) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }

  await sql.begin(async (tx: any) => {
    await tx`
      UPDATE users
      SET password_hash = ${nextPasswordHash}, updated_at = now()
      WHERE id = ${target.id} AND tenant_id = ${target.tenant_id}
    `;

    if (input.revokeSessions) {
      await tx`
        UPDATE device_sessions
        SET revoked_at = now()
        WHERE tenant_id = ${target.tenant_id} AND user_id = ${target.id} AND revoked_at IS NULL
      `;
    }
  });

  console.log(
    JSON.stringify({
      event: "internalAdmin.forcePassword",
      targetUserId: target.id,
      targetTenantId: target.tenant_id,
      targetEmail: target.email,
      targetRole: target.role,
      targetStatus: target.status,
      revokeSessions: input.revokeSessions,
      reason: input.reason ?? null,
      identificationMethod: input.userId ? "userId" : "tenantId+email",
    }),
  );

  return c.json({
    ok: true,
    user: {
      id: target.id,
      tenantId: target.tenant_id,
      email: target.email,
      name: target.name,
      role: target.role,
      status: target.status,
    },
    sessionsRevoked: input.revokeSessions,
  });
});
