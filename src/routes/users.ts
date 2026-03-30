import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db";
import { hashSecret } from "../auth/password";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import type { HonoVariables } from "../context";
import { roleDefaultPermissions, type Role } from "../rbac";

const RoleSchema = z.enum(["owner", "admin", "cashier"]);

const PermissionsSchema = z
  .object({
    canManageCashiers: z.boolean().optional(),
    canManageProducts: z.boolean().optional(),
    canManageCategories: z.boolean().optional(),
    canManageDiscounts: z.boolean().optional(),
    canManageCustomers: z.boolean().optional(),
    canEditTransactions: z.boolean().optional(),
    canDeleteTransactions: z.boolean().optional(),
    canAddExpenses: z.boolean().optional(),
    canViewReports: z.boolean().optional(),
  })
  .strict();

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  phone: z.string().min(1).optional(),
  role: RoleSchema,
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  password: z.string().min(6).optional(),
  permissions: PermissionsSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  role: RoleSchema.optional(),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  password: z.string().min(6).optional(),
  permissions: PermissionsSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const usersRoutes = new Hono<{ Variables: HonoVariables }>()
  .use("*", requireAuth)
  .get("/", requirePermission("canManageCashiers"), async (c: any) => {
    const authUser = c.get("authUser")!;
    console.log(
      JSON.stringify({
        event: "users.list",
        tenantId: authUser.tenantId,
        actorUserId: authUser.id,
        actorRole: authUser.role,
      }),
    );
    const rows = (await sql`
      SELECT id, email, name, phone, role, status, permissions, created_at, updated_at
      FROM users
      WHERE tenant_id = ${authUser.tenantId}
      ORDER BY created_at DESC
    `) as unknown as {
      id: string;
      email: string;
      name: string;
      phone: string | null;
      role: Role;
      status: string;
      permissions: any;
      created_at: string;
      updated_at: string;
    }[];
    return c.json({ users: rows });
  })
  .post("/", requirePermission("canManageCashiers"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const input = CreateUserSchema.parse(await c.req.json());

    if (input.role === "cashier" && !input.pin) return c.json({ error: "PIN_REQUIRED" }, 400);
    if (input.role === "admin" && !input.password && !input.pin) return c.json({ error: "PASSWORD_OR_PIN_REQUIRED" }, 400);

    const permissions = { ...roleDefaultPermissions(input.role), ...(input.permissions ?? {}) };
    const passwordHash = input.password ? await hashSecret(input.password) : null;
    const pinHash = input.pin ? await hashSecret(input.pin) : null;
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const phone = input.phone?.trim();

    const existing = await sql<{ id: string }[]>`
      SELECT id
      FROM users
      WHERE tenant_id = ${authUser.tenantId} AND lower(email) = ${email}
      LIMIT 1
    `;
    if (existing[0]) return c.json({ error: "EMAIL_TAKEN" }, 409);

    let rows: { id: string; tenant_id: string; email: string; name: string; phone: string | null; role: Role; status: string; permissions: any }[];
    try {
      rows = (await sql`
        INSERT INTO users (tenant_id, email, name, phone, role, status, password_hash, pin_hash, permissions)
        VALUES (
          ${authUser.tenantId},
          ${email},
          ${name},
          ${phone ?? null},
          ${input.role},
          ${input.status ?? "active"},
          ${passwordHash},
          ${pinHash},
          ${sql.json(permissions)}
        )
        RETURNING id, tenant_id, email, name, phone, role, status, permissions
      `) as unknown as { id: string; tenant_id: string; email: string; name: string; phone: string | null; role: Role; status: string; permissions: any }[];
    } catch (e: any) {
      if (e?.code === "23505") return c.json({ error: "EMAIL_TAKEN" }, 409);
      throw e;
    }
    console.log(
      JSON.stringify({
        event: "users.create",
        tenantId: authUser.tenantId,
        actorUserId: authUser.id,
        actorRole: authUser.role,
        createdUserId: rows[0]?.id,
        createdEmail: rows[0]?.email,
        createdRole: rows[0]?.role,
        hasPin: Boolean(input.pin),
        hasPassword: Boolean(input.password),
      }),
    );
    return c.json({ user: rows[0] }, 201);
  })
  .patch("/:id", requirePermission("canManageCashiers"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    const input = UpdateUserSchema.parse(await c.req.json());

    const currentRows = (await sql`
      SELECT id, role, permissions
      FROM users
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId}
      LIMIT 1
    `) as unknown as { id: string; role: Role; permissions: any }[];
    const current = currentRows[0];
    if (!current) return c.json({ error: "NOT_FOUND" }, 404);

    const nextRole = (input.role ?? current.role) as Role;
    const base = roleDefaultPermissions(nextRole);
    const merged = { ...base, ...(current.permissions ?? {}), ...(input.permissions ?? {}) };

    const passwordHash = input.password ? await hashSecret(input.password) : undefined;
    const pinHash = input.pin ? await hashSecret(input.pin) : undefined;

    const updated = (await sql`
      UPDATE users
      SET
        name = COALESCE(${input.name ?? null}, name),
        phone = COALESCE(${input.phone ?? null}, phone),
        role = COALESCE(${input.role ?? null}, role),
        status = COALESCE(${input.status ?? null}, status),
        password_hash = COALESCE(${passwordHash ?? null}, password_hash),
        pin_hash = COALESCE(${pinHash ?? null}, pin_hash),
        permissions = ${sql.json(merged)},
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId}
      RETURNING id, email, name, phone, role, status, permissions
    `) as unknown as { id: string; email: string; name: string; phone: string | null; role: Role; status: string; permissions: any }[];
    console.log(
      JSON.stringify({
        event: "users.update",
        tenantId: authUser.tenantId,
        actorUserId: authUser.id,
        actorRole: authUser.role,
        targetUserId: id,
        updatedRole: updated[0]?.role,
        status: updated[0]?.status,
        hasPinUpdate: Boolean(input.pin),
        hasPasswordUpdate: Boolean(input.password),
        hasPermissionsUpdate: Boolean(input.permissions && Object.keys(input.permissions).length),
      }),
    );
    return c.json({ user: updated[0] });
  })
  .post("/:id/revoke-sessions", requirePermission("canManageCashiers"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");
    console.log(
      JSON.stringify({
        event: "users.revokeSessions",
        tenantId: authUser.tenantId,
        actorUserId: authUser.id,
        actorRole: authUser.role,
        targetUserId: id,
      }),
    );
    await sql`
      UPDATE device_sessions
      SET revoked_at = now()
      WHERE tenant_id = ${authUser.tenantId} AND user_id = ${id} AND revoked_at IS NULL
    `;
    return c.json({ ok: true });
  })
  .delete("/:id", requirePermission("canManageCashiers"), async (c: any) => {
    const authUser = c.get("authUser")!;
    const id = c.req.param("id");

    if (id === authUser.id) return c.json({ error: "CANNOT_DELETE_SELF" }, 400);

    const rows = (await sql<{ id: string; role: Role }[]>`
      SELECT id, role
      FROM users
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId}
      LIMIT 1
    `) as unknown as { id: string; role: Role }[];
    const target = rows[0];
    if (!target) return c.json({ error: "NOT_FOUND" }, 404);
    if (target.role === "owner") return c.json({ error: "CANNOT_DELETE_OWNER" }, 400);

    console.log(
      JSON.stringify({
        event: "users.delete",
        tenantId: authUser.tenantId,
        actorUserId: authUser.id,
        actorRole: authUser.role,
        targetUserId: id,
        targetRole: target.role,
      }),
    );

    await sql`
      DELETE FROM users
      WHERE id = ${id} AND tenant_id = ${authUser.tenantId}
    `;
    return c.json({ ok: true });
  });
