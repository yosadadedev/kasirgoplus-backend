import type { Context, Next } from "hono";
import type { HonoVariables } from "../context";
import { verifyAccessToken } from "../auth/jwt";
import { sql } from "../db";
import type { Permissions, Role } from "../rbac";

const getBearer = (c: Context) => {
  const header = c.req.header("Authorization") || c.req.header("authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
};

export const requireAuth = async (c: Context<{ Variables: HonoVariables }>, next: Next) => {
  const token = getBearer(c);
  if (!token) return c.json({ error: "UNAUTHORIZED" }, 401);
  try {
    const claims = await verifyAccessToken(token);
    if (!claims.sid) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    {
      const rows = (await sql<{ revoked_at: string | null }[]>`
        SELECT revoked_at
        FROM device_sessions
        WHERE id = ${claims.sid} AND user_id = ${claims.sub} AND tenant_id = ${claims.tenant_id}
        LIMIT 1
      `) as unknown as { revoked_at: string | null }[];
      const s = rows[0];
      if (!s || s.revoked_at) return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    c.set("authUser", {
      id: claims.sub,
      tenantId: claims.tenant_id,
      sessionId: claims.sid,
      role: claims.role as Role,
      permissions: (claims.permissions ?? null) as Partial<Permissions> | null,
    });
    await next();
  } catch {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
};
