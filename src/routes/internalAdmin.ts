import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { hashSecret } from "../auth/password";
import { sql } from "../db";
import { env } from "../env";

const InternalAdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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

const SortBySchema = z.enum(["createdAt", "lastLoginAt", "totalSales", "totalTransactions"]);
const SortOrderSchema = z.enum(["asc", "desc"]);

const UserStatsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    tenantId: z.string().uuid().optional(),
    role: z.enum(["owner", "admin", "cashier"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    search: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    cursor: z.string().min(1).optional(),
    sortBy: SortBySchema.optional().default("totalSales"),
    sortOrder: SortOrderSchema.optional().default("desc"),
  })
  .superRefine((input, ctx) => {
    if (input.from && input.to && new Date(input.from).getTime() > new Date(input.to).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`from` tidak boleh lebih besar dari `to`.",
        path: ["from"],
      });
    }
  });

type UserStatsQuery = z.infer<typeof UserStatsQuerySchema>;
type SortBy = z.infer<typeof SortBySchema>;
type SortOrder = z.infer<typeof SortOrderSchema>;

const CursorPayloadSchema = z.object({
  sortBy: SortBySchema,
  sortOrder: SortOrderSchema,
  id: z.string().min(1),
  numberValue: z.number().optional(),
  timestampValue: z.string().datetime({ offset: true }).nullable().optional(),
  nullRank: z.number().int().min(0).max(1).optional(),
});

type CursorPayload = z.infer<typeof CursorPayloadSchema>;

type UserStatsRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_status: string;
  email: string;
  name: string;
  role: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  active_session_count: string | number;
  total_transactions: string | number;
  total_sales: string | number;
  deleted_transactions: string | number;
  edited_transactions: string | number;
  kasbon_transactions: string | number;
  kasbon_sales: string | number;
  total_expenses: string | number;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const base64UrlEncode = (value: string) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
};

const compareSecret = (received: string, expected: string) => {
  const left = Buffer.from(received, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

const getBearerToken = (headerValue?: string | null) => {
  const header = (headerValue || "").trim();
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
};

const getInternalSecret = (headerValue?: string | null) => {
  const direct = (headerValue || "").trim();
  return direct || null;
};

const hasInternalAdminSecret = () => Boolean(env.INTERNAL_ADMIN_SECRET);
const hasInternalAdminLogin = () => Boolean(env.ADMIN_JWT_SECRET && env.ADMIN_EMAIL && env.ADMIN_PASSWORD);

const getInternalAdminJwtKey = () => new TextEncoder().encode(env.ADMIN_JWT_SECRET!);

const signInternalAdminAccessToken = async (email: string) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: "internal-admin",
    email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(email)
    .setAudience("internal-admin")
    .setIssuedAt(now)
    .setExpirationTime(now + env.INTERNAL_ADMIN_ACCESS_TOKEN_TTL_SECONDS)
    .sign(getInternalAdminJwtKey());
};

const verifyInternalAdminAccessToken = async (token: string) => {
  const verified = await jwtVerify(token, getInternalAdminJwtKey(), {
    audience: "internal-admin",
  });

  const payload = verified.payload as {
    sub?: string;
    email?: string;
    scope?: string;
  };

  if (payload.scope !== "internal-admin" || !payload.sub || !payload.email) {
    throw new Error("INVALID_INTERNAL_ADMIN_TOKEN");
  }

  const configuredEmail = normalizeEmail(env.ADMIN_EMAIL!);
  if (normalizeEmail(payload.email) !== configuredEmail || normalizeEmail(payload.sub) !== configuredEmail) {
    throw new Error("INVALID_INTERNAL_ADMIN_TOKEN");
  }

  return {
    email: configuredEmail,
  };
};

const ensureInternalAdminAccess = async (c: any) => {
  const bearerToken = getBearerToken(c.req.header("authorization"));
  if (bearerToken && hasInternalAdminLogin()) {
    try {
      const admin = await verifyInternalAdminAccessToken(bearerToken);
      c.set("internalAdmin", {
        authType: "token",
        email: admin.email,
      });
      return null;
    } catch {
      // Fall through to secret-based auth for backward compatibility.
    }
  }

  const providedSecret = getInternalSecret(c.req.header("x-internal-admin-secret"));
  if (providedSecret && hasInternalAdminSecret() && compareSecret(providedSecret, env.INTERNAL_ADMIN_SECRET!)) {
    c.set("internalAdmin", {
      authType: "secret",
      email: null,
    });
    return null;
  }

  if (!hasInternalAdminLogin() && !hasInternalAdminSecret()) {
    return c.json({ error: "INTERNAL_ADMIN_DISABLED" }, 503);
  }

  return c.json({ error: "UNAUTHORIZED" }, 401);
};

const parseCursor = (cursor: string | undefined, sortBy: SortBy, sortOrder: SortOrder) => {
  if (!cursor) return null;

  try {
    const decoded = base64UrlDecode(cursor);
    const parsed = CursorPayloadSchema.parse(JSON.parse(decoded));
    if (parsed.sortBy !== sortBy || parsed.sortOrder !== sortOrder) {
      return { error: "INVALID_CURSOR" as const };
    }
    if ((parsed.sortBy === "totalSales" || parsed.sortBy === "totalTransactions") && typeof parsed.numberValue !== "number") {
      return { error: "INVALID_CURSOR" as const };
    }
    if (parsed.sortBy === "createdAt" && !parsed.timestampValue) {
      return { error: "INVALID_CURSOR" as const };
    }
    if (parsed.sortBy === "lastLoginAt" && (parsed.nullRank ?? 0) === 0 && !parsed.timestampValue) {
      return { error: "INVALID_CURSOR" as const };
    }
    return { value: parsed };
  } catch {
    return { error: "INVALID_CURSOR" as const };
  }
};

const encodeCursor = (payload: CursorPayload) => base64UrlEncode(JSON.stringify(payload));

const buildFilteredUsersClause = (input: UserStatsQuery) => {
  const where: string[] = ["1 = 1"];
  const params: any[] = [];

  if (input.tenantId) {
    where.push(`u.tenant_id = $${params.length + 1}`);
    params.push(input.tenantId);
  }

  if (input.role) {
    where.push(`u.role = $${params.length + 1}`);
    params.push(input.role);
  }

  if (input.status) {
    where.push(`u.status = $${params.length + 1}`);
    params.push(input.status);
  }

  if (input.search) {
    where.push(`(
      lower(u.name) LIKE $${params.length + 1}
      OR lower(u.email) LIKE $${params.length + 1}
      OR lower(t.name) LIKE $${params.length + 1}
    )`);
    params.push(`%${input.search.trim().toLowerCase()}%`);
  }

  return { whereSql: where.join(" AND "), params };
};

const buildActivityFilters = (input: UserStatsQuery, params: any[]) => {
  const transactionWhere: string[] = ["tr.created_by IS NOT NULL"];
  const expenseWhere: string[] = ["e.created_by IS NOT NULL"];

  if (input.from) {
    transactionWhere.push(`tr.timestamp >= $${params.length + 1}`);
    expenseWhere.push(`e.date >= $${params.length + 1}`);
    params.push(input.from);
  }

  if (input.to) {
    transactionWhere.push(`tr.timestamp <= $${params.length + 1}`);
    expenseWhere.push(`e.date <= $${params.length + 1}`);
    params.push(input.to);
  }

  return {
    transactionWhereSql: `WHERE ${transactionWhere.join(" AND ")}`,
    expenseWhereSql: `WHERE ${expenseWhere.join(" AND ")}`,
    params,
  };
};

const buildStatsBaseCte = (baseWhereSql: string, transactionWhereSql: string, expenseWhereSql: string) => `
  WITH filtered_users AS (
    SELECT
      u.id,
      u.tenant_id,
      u.email,
      u.name,
      u.role,
      u.status,
      u.created_at,
      u.last_login_at,
      t.name AS tenant_name,
      t.status AS tenant_status
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE ${baseWhereSql}
  ),
  tx AS (
    SELECT
      tr.created_by AS user_id,
      COUNT(*) FILTER (WHERE tr.deleted_at IS NULL) AS total_transactions,
      COALESCE(SUM(tr.total) FILTER (WHERE tr.deleted_at IS NULL), 0) AS total_sales,
      COUNT(*) FILTER (WHERE tr.deleted_at IS NOT NULL) AS deleted_transactions,
      COUNT(*) FILTER (WHERE tr.deleted_at IS NULL AND tr.is_edited = true) AS edited_transactions,
      COUNT(*) FILTER (WHERE tr.deleted_at IS NULL AND tr.payment_method = 'kasbon') AS kasbon_transactions,
      COALESCE(SUM(tr.total) FILTER (WHERE tr.deleted_at IS NULL AND tr.payment_method = 'kasbon'), 0) AS kasbon_sales
    FROM transactions tr
    JOIN filtered_users fu ON fu.id = tr.created_by
    ${transactionWhereSql}
    GROUP BY tr.created_by
  ),
  ex AS (
    SELECT
      e.created_by AS user_id,
      COALESCE(SUM(e.amount) FILTER (WHERE e.deleted_at IS NULL), 0) AS total_expenses
    FROM expenses e
    JOIN filtered_users fu ON fu.id = e.created_by
    ${expenseWhereSql}
    GROUP BY e.created_by
  ),
  ds AS (
    SELECT
      user_id,
      COUNT(*) FILTER (WHERE revoked_at IS NULL) AS active_session_count
    FROM device_sessions
    WHERE user_id IN (SELECT id FROM filtered_users)
    GROUP BY user_id
  ),
  enriched_users AS (
    SELECT
      fu.id,
      fu.tenant_id,
      fu.tenant_name,
      fu.tenant_status,
      fu.email,
      fu.name,
      fu.role,
      fu.status,
      fu.created_at,
      fu.last_login_at,
      COALESCE(ds.active_session_count, 0) AS active_session_count,
      COALESCE(tx.total_transactions, 0) AS total_transactions,
      COALESCE(tx.total_sales, 0) AS total_sales,
      COALESCE(tx.deleted_transactions, 0) AS deleted_transactions,
      COALESCE(tx.edited_transactions, 0) AS edited_transactions,
      COALESCE(tx.kasbon_transactions, 0) AS kasbon_transactions,
      COALESCE(tx.kasbon_sales, 0) AS kasbon_sales,
      COALESCE(ex.total_expenses, 0) AS total_expenses
    FROM filtered_users fu
    LEFT JOIN tx ON tx.user_id = fu.id
    LEFT JOIN ex ON ex.user_id = fu.id
    LEFT JOIN ds ON ds.user_id = fu.id
  )
`;

const getOrderBySql = (sortBy: SortBy, sortOrder: SortOrder) => {
  const direction = sortOrder === "asc" ? "ASC" : "DESC";

  switch (sortBy) {
    case "createdAt":
      return `eu.created_at ${direction}, eu.id ASC`;
    case "lastLoginAt":
      return `CASE WHEN eu.last_login_at IS NULL THEN 1 ELSE 0 END ASC, eu.last_login_at ${direction}, eu.id ASC`;
    case "totalTransactions":
      return `eu.total_transactions ${direction}, eu.id ASC`;
    case "totalSales":
    default:
      return `eu.total_sales ${direction}, eu.id ASC`;
  }
};

const buildCursorWhereSql = (cursor: CursorPayload | null, params: any[]) => {
  if (!cursor) return "";

  if (cursor.sortBy === "totalSales" || cursor.sortBy === "totalTransactions") {
    const sortColumn = cursor.sortBy === "totalSales" ? "eu.total_sales" : "eu.total_transactions";
    const comparison = cursor.sortOrder === "asc" ? ">" : "<";
    const valueIndex = params.length + 1;
    const idIndex = params.length + 2;
    params.push(cursor.numberValue ?? 0, cursor.id);
    return `WHERE (${sortColumn} ${comparison} $${valueIndex} OR (${sortColumn} = $${valueIndex} AND eu.id > $${idIndex}))`;
  }

  if (cursor.sortBy === "createdAt") {
    const comparison = cursor.sortOrder === "asc" ? ">" : "<";
    const valueIndex = params.length + 1;
    const idIndex = params.length + 2;
    params.push(cursor.timestampValue!, cursor.id);
    return `WHERE (eu.created_at ${comparison} $${valueIndex} OR (eu.created_at = $${valueIndex} AND eu.id > $${idIndex}))`;
  }

  const nullRankExpr = `CASE WHEN eu.last_login_at IS NULL THEN 1 ELSE 0 END`;
  const idIndex = params.length + 1;

  if ((cursor.nullRank ?? 0) === 1) {
    params.push(cursor.id);
    return `WHERE (${nullRankExpr} = 1 AND eu.id > $${idIndex})`;
  }

  const comparison = cursor.sortOrder === "asc" ? ">" : "<";
  const timestampIndex = params.length + 1;
  const nextIdIndex = params.length + 2;
  params.push(cursor.timestampValue!, cursor.id);

  return `WHERE (
    ${nullRankExpr} > 0
    OR (
      ${nullRankExpr} = 0
      AND (
        eu.last_login_at ${comparison} $${timestampIndex}
        OR (eu.last_login_at = $${timestampIndex} AND eu.id > $${nextIdIndex})
      )
    )
  )`;
};

const buildNextCursor = (row: UserStatsRow, sortBy: SortBy, sortOrder: SortOrder) => {
  if (sortBy === "totalSales") {
    return encodeCursor({
      sortBy,
      sortOrder,
      id: row.id,
      numberValue: Number(row.total_sales ?? 0),
    });
  }

  if (sortBy === "totalTransactions") {
    return encodeCursor({
      sortBy,
      sortOrder,
      id: row.id,
      numberValue: Number(row.total_transactions ?? 0),
    });
  }

  if (sortBy === "createdAt") {
    return encodeCursor({
      sortBy,
      sortOrder,
      id: row.id,
      timestampValue: row.created_at,
    });
  }

  return encodeCursor({
    sortBy,
    sortOrder,
    id: row.id,
    timestampValue: row.last_login_at,
    nullRank: row.last_login_at ? 0 : 1,
  });
};

export const internalAdminRoutes = new Hono()
  .post("/auth/login", async (c: any) => {
    if (!hasInternalAdminLogin()) {
      return c.json({ error: "INTERNAL_ADMIN_LOGIN_DISABLED" }, 503);
    }

    const input = InternalAdminLoginSchema.parse(await c.req.json());
    const email = normalizeEmail(input.email);
    const configuredEmail = normalizeEmail(env.ADMIN_EMAIL!);
    const configuredPassword = env.ADMIN_PASSWORD!;

    const emailOk = compareSecret(email, configuredEmail);
    const passwordOk = compareSecret(input.password, configuredPassword);
    if (!emailOk || !passwordOk) {
      return c.json({ error: "INVALID_CREDENTIALS" }, 401);
    }

    const accessToken = await signInternalAdminAccessToken(configuredEmail);

    console.log(
      JSON.stringify({
        event: "internalAdmin.login",
        email: configuredEmail,
      }),
    );

    return c.json({
      accessToken,
      expiresInSeconds: env.INTERNAL_ADMIN_ACCESS_TOKEN_TTL_SECONDS,
      admin: {
        email: configuredEmail,
      },
      authMethods: {
        bearerToken: true,
        secretHeaderFallback: hasInternalAdminSecret(),
      },
    });
  })
  .get("/users/stats", async (c: any) => {
    const accessError = await ensureInternalAdminAccess(c);
    if (accessError) return accessError;

    const input = UserStatsQuerySchema.parse(c.req.query());
    const parsedCursor = parseCursor(input.cursor, input.sortBy, input.sortOrder);
    if (parsedCursor?.error) {
      return c.json({ error: "INVALID_CURSOR" }, 400);
    }

    const { whereSql: baseWhereSql, params: baseParams } = buildFilteredUsersClause(input);

    const summaryParams = [...baseParams];
    const summaryActivity = buildActivityFilters(input, summaryParams);
    const summaryBaseCte = buildStatsBaseCte(
      baseWhereSql,
      summaryActivity.transactionWhereSql,
      summaryActivity.expenseWhereSql,
    );

    const summaryRows = await sql.unsafe<
      {
        total_users: string | number;
        active_users: string | number;
        disabled_users: string | number;
        total_transactions: string | number;
        total_sales: string | number;
        total_expenses: string | number;
      }[]
    >(
      `
        ${summaryBaseCte}
        SELECT
          COUNT(*) AS total_users,
          COUNT(*) FILTER (WHERE status = 'active') AS active_users,
          COUNT(*) FILTER (WHERE status = 'disabled') AS disabled_users,
          COALESCE(SUM(total_transactions), 0) AS total_transactions,
          COALESCE(SUM(total_sales), 0) AS total_sales,
          COALESCE(SUM(total_expenses), 0) AS total_expenses
        FROM enriched_users
      `,
      summaryActivity.params,
    );

    const listParams = [...baseParams];
    const listActivity = buildActivityFilters(input, listParams);
    const listBaseCte = buildStatsBaseCte(baseWhereSql, listActivity.transactionWhereSql, listActivity.expenseWhereSql);
    const cursorWhereSql = buildCursorWhereSql(parsedCursor?.value ?? null, listActivity.params);
    const orderBySql = getOrderBySql(input.sortBy, input.sortOrder);
    const limitIndex = listActivity.params.length + 1;
    const useOffset = !input.cursor && input.offset > 0;
    const offsetIndex = useOffset ? listActivity.params.length + 2 : null;

    const rows = await sql.unsafe<UserStatsRow[]>(
      `
        ${listBaseCte}
        SELECT eu.*
        FROM enriched_users eu
        ${cursorWhereSql}
        ORDER BY ${orderBySql}
        LIMIT $${limitIndex}
        ${useOffset ? `OFFSET $${offsetIndex}` : ""}
      `,
      useOffset
        ? [...listActivity.params, input.limit + 1, input.offset]
        : [...listActivity.params, input.limit + 1],
    );

    const hasMore = rows.length > input.limit;
    const visibleRows = hasMore ? rows.slice(0, input.limit) : rows;
    const summary = summaryRows[0];
    const nextCursor = hasMore && visibleRows.length > 0
      ? buildNextCursor(visibleRows[visibleRows.length - 1]!, input.sortBy, input.sortOrder)
      : null;

    console.log(
      JSON.stringify({
        event: "internalAdmin.userStats",
        tenantId: input.tenantId ?? null,
        role: input.role ?? null,
        status: input.status ?? null,
        from: input.from ?? null,
        to: input.to ?? null,
        search: input.search ?? null,
        limit: input.limit,
        offset: input.cursor ? 0 : input.offset,
        hasCursor: Boolean(input.cursor),
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      }),
    );

    return c.json({
      summary: {
        totalUsers: Number(summary?.total_users ?? 0),
        activeUsers: Number(summary?.active_users ?? 0),
        disabledUsers: Number(summary?.disabled_users ?? 0),
        totalTransactions: Number(summary?.total_transactions ?? 0),
        totalSales: Number(summary?.total_sales ?? 0),
        totalExpenses: Number(summary?.total_expenses ?? 0),
      },
      users: visibleRows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        tenantStatus: row.tenant_status,
        email: row.email,
        name: row.name,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        activeSessionCount: Number(row.active_session_count ?? 0),
        stats: {
          totalTransactions: Number(row.total_transactions ?? 0),
          totalSales: Number(row.total_sales ?? 0),
          deletedTransactions: Number(row.deleted_transactions ?? 0),
          editedTransactions: Number(row.edited_transactions ?? 0),
          kasbonTransactions: Number(row.kasbon_transactions ?? 0),
          kasbonSales: Number(row.kasbon_sales ?? 0),
          totalExpenses: Number(row.total_expenses ?? 0),
        },
      })),
      pagination: {
        limit: input.limit,
        mode: input.cursor ? "cursor" : "offset",
        offset: input.cursor ? null : input.offset,
        totalUsers: Number(summary?.total_users ?? 0),
        pageSize: visibleRows.length,
        hasMore,
        nextCursor,
      },
      filters: {
        tenantId: input.tenantId ?? null,
        role: input.role ?? null,
        status: input.status ?? null,
        search: input.search ?? null,
        from: input.from ?? null,
        to: input.to ?? null,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      },
    });
  })
  .post("/users/force-password", async (c: any) => {
    const accessError = await ensureInternalAdminAccess(c);
    if (accessError) return accessError;

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
          WHERE tenant_id = ${input.tenantId!} AND lower(email) = ${normalizeEmail(input.email!)}
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
