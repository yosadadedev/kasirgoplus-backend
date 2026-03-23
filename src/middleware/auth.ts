import type { Context, Next } from "hono";
import type { HonoVariables } from "../context";
import { verifyAccessToken } from "../auth/jwt";
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
    c.set("authUser", {
      id: claims.sub,
      tenantId: claims.tenant_id,
      role: claims.role as Role,
      permissions: (claims.permissions ?? null) as Partial<Permissions> | null,
    });
    await next();
  } catch {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
};

