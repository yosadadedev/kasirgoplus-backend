export const permissionKeys = [
  "canManageCashiers",
  "canManageProducts",
  "canManageCategories",
  "canManageDiscounts",
  "canManageCustomers",
  "canEditTransactions",
  "canManageKasbon",
  "canDeleteTransactions",
  "canAddExpenses",
  "canViewReports",
  "canViewTransactionHistory",
  "canManageQris",
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
    canManageKasbon: true,
    canDeleteTransactions: false,
    canAddExpenses: true,
    canViewReports: false,
    canViewTransactionHistory: true,
    canManageQris: false,
  };
  if (role === "owner") return all;
  if (role === "admin") return all;
  return cashier;
};

// canManageKasbon (Kelola Piutang) was split out of canEditTransactions. Users saved before
// the split have no canManageKasbon yet; they keep the kasbon access canEditTransactions gave them.
export const withLegacyPermissions = <T extends Partial<Permissions> | null | undefined>(perms: T): T => {
  if (!perms || perms.canManageKasbon !== undefined || perms.canEditTransactions === undefined) return perms;
  return { ...perms, canManageKasbon: perms.canEditTransactions };
};

export const hasPermission = (role: Role, permissions: Partial<Permissions> | null | undefined, key: PermissionKey) => {
  if (role === "owner") return true;
  const merged = { ...roleDefaultPermissions(role), ...(withLegacyPermissions(permissions) ?? {}) } as Permissions;
  return Boolean(merged[key]);
};

