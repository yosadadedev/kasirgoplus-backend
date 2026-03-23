export const permissionKeys = [
  "canManageCashiers",
  "canManageProducts",
  "canManageCategories",
  "canManageDiscounts",
  "canManageCustomers",
  "canEditTransactions",
  "canDeleteTransactions",
  "canAddExpenses",
  "canViewReports",
] as const;

export type PermissionKey = (typeof permissionKeys)[number];

export type Role = "owner" | "admin" | "cashier";

export type Permissions = Record<PermissionKey, boolean>;

export const roleDefaultPermissions = (role: Role): Permissions => {
  const all = Object.fromEntries(permissionKeys.map((k) => [k, true])) as Permissions;
  const cashier: Permissions = {
    canManageCashiers: false,
    canManageProducts: true,
    canManageCategories: true,
    canManageDiscounts: false,
    canManageCustomers: false,
    canEditTransactions: true,
    canDeleteTransactions: false,
    canAddExpenses: true,
    canViewReports: false,
  };
  if (role === "owner") return all;
  if (role === "admin") return all;
  return cashier;
};

export const hasPermission = (role: Role, permissions: Partial<Permissions> | null | undefined, key: PermissionKey) => {
  if (role === "owner") return true;
  const merged = { ...roleDefaultPermissions(role), ...(permissions ?? {}) } as Permissions;
  return Boolean(merged[key]);
};

