import type { Permissions, Role } from "./rbac";

export type AuthUser = {
  id: string;
  tenantId: string;
  role: Role;
  permissions: Partial<Permissions> | null;
};

export type HonoVariables = {
  authUser?: AuthUser;
};

