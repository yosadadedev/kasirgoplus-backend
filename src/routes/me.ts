import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { requireAuth } from "../middleware/auth";
import type { HonoVariables } from "../context";
import { permissionKeys, roleDefaultPermissions, withLegacyPermissions, type Permissions, type Role } from "../rbac";
import { hashSecret, verifySecret } from "../auth/password";
import { sha256Hex } from "../auth/crypto";
import { signAccessToken } from "../auth/jwt";
import { deleteTenantImagesFromR2 } from "../services/r2";

const UpdateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
});

const DeleteAccountSchema = z.object({
  password: z.string().min(1),
});

// Brute-force guard for account deletion (migration 023).
const DELETE_ACCOUNT_MAX_ATTEMPTS = 5;
const DELETE_ACCOUNT_LOCK_MINUTES = 15;

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
  pin_hash?: string | null;
  delete_failed_attempts?: number;
  delete_locked_until?: Date | null;
  permissions: Permissions | null;
};

const normalizePermissions = (role: Role, perms: Permissions | null) => {
  const base = roleDefaultPermissions(role);
  const merged = { ...base, ...(withLegacyPermissions(perms) ?? {}) } as Permissions;
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
  .delete("/", async (c: any) => {
    const authUser = c.get("authUser")!;
    // Older app versions send no body; let that fail validation (400) instead of a JSON parse 500.
    const input = DeleteAccountSchema.parse(await c.req.json().catch(() => ({})));
    const rows = (await sql<DbUserRow[]>`
      SELECT id, tenant_id, email, name, phone, role, status, password_hash, pin_hash,
        delete_failed_attempts, delete_locked_until, permissions
      FROM users
      WHERE id = ${authUser.id} AND tenant_id = ${authUser.tenantId}
      LIMIT 1
    `) as unknown as DbUserRow[];
    const user = rows[0];
    if (!user) return c.json({ error: "NOT_FOUND" }, 404);

    // While locked, refuse without checking the password at all, so guessing can't continue.
    const lockedUntilMs = user.delete_locked_until ? new Date(user.delete_locked_until).getTime() : 0;
    if (lockedUntilMs > Date.now()) {
      return c.json(
        {
          error: "TOO_MANY_ATTEMPTS",
          retryAfterSeconds: Math.ceil((lockedUntilMs - Date.now()) / 1000),
        },
        429,
      );
    }

    // Same rule as login: the password, or the PIN for cashiers who only have one.
    // 403 rather than 401 so the client doesn't treat a typo as an expired session and refresh.
    const passwordOk = user.password_hash
      ? await verifySecret(input.password, user.password_hash)
      : false;
    const pinOk =
      !passwordOk && user.pin_hash ? await verifySecret(input.password, user.pin_hash) : false;
    if (!passwordOk && !pinOk) {
      // One UPDATE so parallel requests can't slip past the limit. An expired lock starts a
      // fresh count. (SET expressions all read the row's old values.)
      const [attempt] = (await sql`
        UPDATE users
        SET
          delete_failed_attempts = CASE
            WHEN delete_locked_until IS NOT NULL AND delete_locked_until <= now() THEN 1
            ELSE delete_failed_attempts + 1
          END,
          delete_locked_until = CASE
            WHEN (CASE
              WHEN delete_locked_until IS NOT NULL AND delete_locked_until <= now() THEN 1
              ELSE delete_failed_attempts + 1
            END) >= ${DELETE_ACCOUNT_MAX_ATTEMPTS}
              THEN now() + ${DELETE_ACCOUNT_LOCK_MINUTES}::int * interval '1 minute'
            WHEN delete_locked_until IS NOT NULL AND delete_locked_until <= now() THEN NULL
            ELSE delete_locked_until
          END
        WHERE id = ${user.id} AND tenant_id = ${user.tenant_id}
        RETURNING delete_failed_attempts
      `) as unknown as { delete_failed_attempts: number }[];

      const failed = attempt?.delete_failed_attempts ?? DELETE_ACCOUNT_MAX_ATTEMPTS;
      console.log(
        JSON.stringify({
          event: "me.delete.wrong_password",
          tenantId: user.tenant_id,
          userId: user.id,
          failedAttempts: failed,
        }),
      );
      if (failed >= DELETE_ACCOUNT_MAX_ATTEMPTS) {
        return c.json(
          { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: DELETE_ACCOUNT_LOCK_MINUTES * 60 },
          429,
        );
      }
      return c.json(
        { error: "INVALID_CREDENTIALS", remainingAttempts: DELETE_ACCOUNT_MAX_ATTEMPTS - failed },
        403,
      );
    }

    const deletedScope = await sql.begin(async (tx: any) => {
      if (user.role === "owner") {
        await tx`
          DELETE FROM tenants
          WHERE id = ${user.tenant_id}
        `;
        return "tenant" as const;
      }

      await tx`
        DELETE FROM users
        WHERE id = ${user.id} AND tenant_id = ${user.tenant_id}
      `;
      return "user" as const;
    });

    console.log(
      JSON.stringify({
        event: "me.delete",
        tenantId: user.tenant_id,
        userId: user.id,
        role: user.role,
        deletedScope,
      }),
    );

    // The business rows are gone; remove its images too. Runs after the response so a large
    // catalog doesn't time out the request. A failure is logged with the tenant id so the
    // prefix tenants/{tenantId}/ can be cleaned up by hand.
    if (deletedScope === "tenant") {
      void deleteTenantImagesFromR2(user.tenant_id)
        .then(({ deleted }) =>
          console.log(
            JSON.stringify({ event: "me.delete.r2_cleanup", tenantId: user.tenant_id, deleted }),
          ),
        )
        .catch((error) =>
          console.error(
            JSON.stringify({
              event: "me.delete.r2_cleanup_failed",
              tenantId: user.tenant_id,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
    }

    return c.json({ ok: true, deletedScope });
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
