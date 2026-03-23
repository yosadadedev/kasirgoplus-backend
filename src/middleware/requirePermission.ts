import type { Context, Next } from "hono";
import type { HonoVariables } from "../context";
import { hasPermission, type PermissionKey } from "../rbac";

export const requirePermission = (key: PermissionKey) => {
  return async (c: Context<{ Variables: HonoVariables }>, next: Next) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);
    const ok = hasPermission(user.role, user.permissions, key);
    if (!ok) return c.json({ error: "FORBIDDEN" }, 403);
    await next();
  };
};

