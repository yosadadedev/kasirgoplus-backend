import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { env } from "../env";
import { sha256Hex } from "../auth/crypto";
import { signAccessToken } from "../auth/jwt";
import { hashSecret, verifySecret } from "../auth/password";
import { permissionKeys, roleDefaultPermissions, type Permissions, type Role } from "../rbac";

const base64Url = (bytes: Uint8Array) => {
  const b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const generateRefreshToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return base64Url(bytes);
};

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4).optional(),
  pin: z.string().min(4).max(6).optional(),
  deviceId: z.string().min(1).optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
  deviceId: z.string().min(1).optional(),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(10),
});

const RegisterSchema = z.object({
  tenantName: z.string().min(2),
  ownerName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
});

const RequestResetSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(6),
});

type DbUserRow = {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  password_hash: string | null;
  pin_hash: string | null;
  permissions: Permissions | null;
};

const normalizePermissions = (role: Role, perms: Permissions | null) => {
  const base = roleDefaultPermissions(role);
  const merged = { ...base, ...(perms ?? {}) } as Permissions;
  const out: Partial<Permissions> = {};
  for (const k of permissionKeys) out[k] = Boolean(merged[k]);
  return out;
};

const generateOpaqueToken = (byteLen: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLen));
  return base64Url(bytes);
};

export const authRoutes = new Hono()
  .post("/register", async (c: any) => {
    const input = RegisterSchema.parse(await c.req.json());

    const existing = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${input.email} LIMIT 1
    `;
    if (existing[0]) return c.json({ error: "EMAIL_TAKEN" }, 409);

    const tenantRows = await sql<{ id: string }[]>`
      SELECT id FROM tenants WHERE name = ${input.tenantName} LIMIT 1
    `;
    if (tenantRows[0]) return c.json({ error: "TENANT_NAME_TAKEN" }, 409);

    const passwordHash = await hashSecret(input.password);
    const ownerPerms = roleDefaultPermissions("owner");

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = await sha256Hex(refreshToken);

    const created = await sql.begin(async (tx: any) => {
      const newTenant = (await tx<{ id: string }[]>`
        INSERT INTO tenants (name)
        VALUES (${input.tenantName})
        RETURNING id
      `) as unknown as { id: string }[];

      const tenantId = newTenant[0]!.id;

      const newUser = (await tx<
        {
          id: string;
          tenant_id: string;
          email: string;
          name: string;
          role: Role;
          status: string;
          permissions: any;
        }[]
      >`
        INSERT INTO users (tenant_id, email, name, phone, role, status, password_hash, permissions)
        VALUES (${tenantId}, ${input.email}, ${input.ownerName}, ${input.phone ?? null}, 'owner', 'active', ${passwordHash}, ${tx.json(ownerPerms)})
        RETURNING id, tenant_id, email, name, role, status, permissions
      `) as unknown as {
        id: string;
        tenant_id: string;
        email: string;
        name: string;
        role: Role;
        status: string;
        permissions: any;
      }[];

      await tx`
        INSERT INTO device_sessions (tenant_id, user_id, device_id, refresh_token_hash)
        VALUES (${tenantId}, ${newUser[0]!.id}, ${input.deviceId ?? null}, ${refreshTokenHash})
      `;

      return { tenantId, user: newUser[0]! };
    });

    const effectivePerms = normalizePermissions("owner", created.user.permissions as any);
    const accessToken = await signAccessToken({
      sub: created.user.id,
      tenant_id: created.tenantId,
      role: "owner",
      permissions: effectivePerms as Record<string, boolean>,
    });

    return c.json({
      accessToken,
      refreshToken,
      user: {
        id: created.user.id,
        tenantId: created.tenantId,
        email: created.user.email,
        name: created.user.name,
        role: "owner",
        permissions: effectivePerms,
      },
    });
  })
  .post("/login", async (c: any) => {
    const input = LoginSchema.parse(await c.req.json());
    const userRows = await sql<DbUserRow[]>`
      SELECT id, tenant_id, email, name, role, status, password_hash, pin_hash, permissions
      FROM users
      WHERE email = ${input.email}
      LIMIT 1
    `;
    const user = userRows[0];
    if (!user || user.status !== "active") return c.json({ error: "INVALID_CREDENTIALS" }, 401);

    const secret = input.password ?? input.pin;
    if (!secret) return c.json({ error: "INVALID_CREDENTIALS" }, 401);

    const passwordOk = user.password_hash ? await verifySecret(secret, user.password_hash) : false;
    const pinOk = user.pin_hash ? await verifySecret(secret, user.pin_hash) : false;
    if (!passwordOk && !pinOk) return c.json({ error: "INVALID_CREDENTIALS" }, 401);

    const effectivePerms = normalizePermissions(user.role, user.permissions);
    const accessToken = await signAccessToken({
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      permissions: effectivePerms as Record<string, boolean>,
    });

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = await sha256Hex(refreshToken);
    await sql`
      INSERT INTO device_sessions (tenant_id, user_id, device_id, refresh_token_hash)
      VALUES (${user.tenant_id}, ${user.id}, ${input.deviceId ?? null}, ${refreshTokenHash})
    `;

    await sql`
      UPDATE users
      SET last_login_at = now(), updated_at = now()
      WHERE id = ${user.id}
    `;

    return c.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: effectivePerms,
      },
    });
  })
  .post("/refresh", async (c: any) => {
    const input = RefreshSchema.parse(await c.req.json());
    const hash = await sha256Hex(input.refreshToken);
    const rows = await sql<
      (DbUserRow & { session_id: string; session_created_at: string; session_revoked_at: string | null })[]
    >`
      SELECT
        s.id as session_id,
        s.created_at as session_created_at,
        s.revoked_at as session_revoked_at,
        u.id,
        u.tenant_id,
        u.email,
        u.name,
        u.role,
        u.status,
        u.password_hash,
        u.pin_hash,
        u.permissions
      FROM device_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = ${hash}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.session_revoked_at || row.status !== "active") return c.json({ error: "UNAUTHORIZED" }, 401);

    const createdAt = new Date(row.session_created_at).getTime();
    const expiresAt = createdAt + env.REFRESH_TOKEN_TTL_SECONDS * 1000;
    if (Date.now() > expiresAt) return c.json({ error: "UNAUTHORIZED" }, 401);

    const effectivePerms = normalizePermissions(row.role, row.permissions);
    const accessToken = await signAccessToken({
      sub: row.id,
      tenant_id: row.tenant_id,
      role: row.role,
      permissions: effectivePerms as Record<string, boolean>,
    });

    const newRefreshToken = generateRefreshToken();
    const newHash = await sha256Hex(newRefreshToken);
    await sql`
      UPDATE device_sessions
      SET refresh_token_hash = ${newHash}, last_seen_at = now()
      WHERE id = ${row.session_id}
    `;

    return c.json({
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: row.id,
        tenantId: row.tenant_id,
        email: row.email,
        name: row.name,
        role: row.role,
        permissions: effectivePerms,
      },
    });
  })
  .post("/logout", async (c: any) => {
    const input = LogoutSchema.parse(await c.req.json());
    const hash = await sha256Hex(input.refreshToken);
    await sql`
      UPDATE device_sessions
      SET revoked_at = now()
      WHERE refresh_token_hash = ${hash} AND revoked_at IS NULL
    `;
    return c.json({ ok: true });
  })
  .post("/request-password-reset", async (c: any) => {
    const input = RequestResetSchema.parse(await c.req.json());

    const rows = await sql<{ id: string; tenant_id: string }[]>`
      SELECT id, tenant_id
      FROM users
      WHERE email = ${input.email} AND status = 'active'
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) return c.json({ ok: true });

    const token = generateOpaqueToken(48);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_SECONDS * 1000);

    await sql`
      INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at)
      VALUES (${user.tenant_id}, ${user.id}, ${tokenHash}, ${expiresAt})
    `;

    return c.json(env.RETURN_RESET_TOKEN ? { ok: true, resetToken: token } : { ok: true });
  })
  .post("/reset-password", async (c: any) => {
    const input = ResetPasswordSchema.parse(await c.req.json());
    const tokenHash = await sha256Hex(input.token);

    const rows = await sql<
      { id: string; tenant_id: string; user_id: string; expires_at: string; used_at: string | null }[]
    >`
      SELECT id, tenant_id, user_id, expires_at, used_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;
    const prt = rows[0];
    if (!prt || prt.used_at) return c.json({ error: "INVALID_TOKEN" }, 400);
    if (new Date(prt.expires_at).getTime() < Date.now()) return c.json({ error: "INVALID_TOKEN" }, 400);

    const passwordHash = await hashSecret(input.newPassword);

    await sql.begin(async (tx: any) => {
      await tx`
        UPDATE users
        SET password_hash = ${passwordHash}, updated_at = now()
        WHERE id = ${prt.user_id} AND tenant_id = ${prt.tenant_id}
      `;
      await tx`
        UPDATE password_reset_tokens
        SET used_at = now()
        WHERE id = ${prt.id}
      `;
      await tx`
        UPDATE device_sessions
        SET revoked_at = now()
        WHERE tenant_id = ${prt.tenant_id} AND user_id = ${prt.user_id} AND revoked_at IS NULL
      `;
    });

    return c.json({ ok: true });
  });
