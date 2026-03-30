import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";
import { permissionKeys, roleDefaultPermissions, type Permissions, type Role } from "../rbac";
import { hashSecret, verifySecret } from "../auth/password";
import { sha256Hex } from "../auth/crypto";
import { signAccessToken } from "../auth/jwt";

const UpdateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
});

const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
  deviceId: z.string().min(1).optional(),
});

type DbUserRow = {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  status: string;
  password_hash: string | null;
  permissions: Permissions | null;
};

const normalizePermissions = (role: Role, perms: Permissions | null) => {
  const base = roleDefaultPermissions(role);
  const merged = { ...base, ...(perms ?? {}) } as Permissions;
  const out: Partial<Permissions> = {};
  for (const k of permissionKeys) out[k] = Boolean(merged[k]);
  return out;
};

const base64Url = (bytes: Uint8Array) => {
  const b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const generateRefreshToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return base64Url(bytes);
};

export const meRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    const rows = (await sql<DbUserRow[]>`
      SELECT id, tenant_id, email, name, phone, role, status, password_hash, permissions
      FROM users
      WHERE id = ${authUser.id} AND tenant_id = ${authUser.tenantId}
      LIMIT 1
    `) as unknown as DbUserRow[];
    const user = rows[0];
    if (!user) return c.json({ error: "NOT_FOUND" }, 404);

    const effectivePerms = normalizePermissions(user.role, user.permissions);
    return c.json({
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        permissions: effectivePerms,
      },
    });
  })
  .patch("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = UpdateProfileSchema.parse(await c.req.json());
    if (!input.name && !input.phone) return c.json({ error: "NO_CHANGES" }, 400);

    const rows = (await sql`
      UPDATE users
      SET
        name = COALESCE(${input.name ?? null}, name),
        phone = COALESCE(${input.phone ?? null}, phone),
        updated_at = now()
      WHERE id = ${authUser.id} AND tenant_id = ${authUser.tenantId}
      RETURNING id, tenant_id, email, name, phone, role, status, password_hash, permissions
    `) as unknown as DbUserRow[];
    const user = rows[0];
    if (!user) return c.json({ error: "NOT_FOUND" }, 404);

    const effectivePerms = normalizePermissions(user.role, user.permissions);
    return c.json({
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        permissions: effectivePerms,
      },
    });
  })
  .post("/change-password", async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = ChangePasswordSchema.parse(await c.req.json());

    const userRows = (await sql<DbUserRow[]>`
      SELECT id, tenant_id, email, name, phone, role, status, password_hash, permissions
      FROM users
      WHERE id = ${authUser.id} AND tenant_id = ${authUser.tenantId}
      LIMIT 1
    `) as unknown as DbUserRow[];
    const user = userRows[0];
    if (!user) return c.json({ error: "NOT_FOUND" }, 404);
    if (user.status !== "active") return c.json({ error: "UNAUTHORIZED" }, 401);
    if (!user.password_hash) return c.json({ error: "NO_PASSWORD_SET" }, 400);

    const ok = await verifySecret(input.oldPassword, user.password_hash);
    if (!ok) return c.json({ error: "INVALID_CREDENTIALS" }, 401);

    const newHash = await hashSecret(input.newPassword);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = await sha256Hex(refreshToken);

    const sessionId = await sql.begin(async (tx: any) => {
      await tx`
        UPDATE users
        SET password_hash = ${newHash}, updated_at = now()
        WHERE id = ${user.id} AND tenant_id = ${user.tenant_id}
      `;
      await tx`
        UPDATE device_sessions
        SET revoked_at = now()
        WHERE tenant_id = ${user.tenant_id} AND user_id = ${user.id} AND revoked_at IS NULL
      `;
      const rows = (await tx<{ id: string }[]>`
        INSERT INTO device_sessions (tenant_id, user_id, device_id, refresh_token_hash)
        VALUES (${user.tenant_id}, ${user.id}, ${input.deviceId ?? null}, ${refreshTokenHash})
        RETURNING id
      `) as unknown as { id: string }[];
      return rows[0]!.id;
    });

    const effectivePerms = normalizePermissions(user.role, user.permissions);
    const accessToken = await signAccessToken({
      sub: user.id,
      tenant_id: user.tenant_id,
      sid: sessionId,
      role: user.role,
      permissions: effectivePerms as Record<string, boolean>,
    });

    return c.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        permissions: effectivePerms,
      },
    });
  });
