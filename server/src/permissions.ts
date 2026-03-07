/**
 * RBAC: Permission registry and helpers.
 * Permission IDs must match seeded values in migration 20260308000000_rbac_roles_and_permissions.sql
 */

export const PERMISSION_IDS = {
  // Admin
  MANAGE_BRANCHES: 'manage_branches',
  MANAGE_SERVICES: 'manage_services',
  MANAGE_PACKAGES: 'manage_packages',
  MANAGE_EMPLOYEES: 'manage_employees',
  MANAGE_SHIFTS: 'manage_shifts',
  MANAGE_BOOKINGS: 'manage_bookings',
  VIEW_REPORTS: 'view_reports',
  MANAGE_ROLES: 'manage_roles',
  VIEW_INCOME: 'view_income',
  ACCESS_SUPPORT_TICKETS: 'access_support_tickets',
  EDIT_SYSTEM_SETTINGS: 'edit_system_settings',
  // Employee (assign_employee removed: assignment is part of create/edit booking; create_subscriptions merged into sell_packages)
  CREATE_BOOKING: 'create_booking',
  EDIT_BOOKING: 'edit_booking',
  CANCEL_BOOKING: 'cancel_booking',
  SELL_PACKAGES: 'sell_packages',
  REGISTER_VISITORS: 'register_visitors',
  VIEW_SCHEDULES: 'view_schedules',
  PROCESS_PAYMENTS: 'process_payments',
  /** Update booking/subscription payment status (e.g. mark as paid); invoices created/sent when payment recorded */
  UPDATE_PAYMENT_STATUS: 'issue_invoices',
} as const;

export type PermissionId = (typeof PERMISSION_IDS)[keyof typeof PERMISSION_IDS];

/** All permission IDs (single source of truth for "full admin" credentials) */
export const ALL_PERMISSION_IDS: PermissionId[] = Object.values(PERMISSION_IDS);

/** Legacy role → permission IDs (used when user has no role_id) */
const LEGACY_ROLE_PERMISSIONS: Record<string, PermissionId[]> = {
  solution_owner: ALL_PERMISSION_IDS,
  tenant_admin: ALL_PERMISSION_IDS,
  receptionist: [
    PERMISSION_IDS.CREATE_BOOKING,
    PERMISSION_IDS.EDIT_BOOKING,
    PERMISSION_IDS.CANCEL_BOOKING,
    PERMISSION_IDS.SELL_PACKAGES,
    PERMISSION_IDS.REGISTER_VISITORS,
    PERMISSION_IDS.VIEW_SCHEDULES,
    PERMISSION_IDS.PROCESS_PAYMENTS,
    PERMISSION_IDS.UPDATE_PAYMENT_STATUS,
    PERMISSION_IDS.VIEW_REPORTS,
  ],
  cashier: [
    PERMISSION_IDS.SELL_PACKAGES,
    PERMISSION_IDS.VIEW_SCHEDULES,
    PERMISSION_IDS.PROCESS_PAYMENTS,
    PERMISSION_IDS.UPDATE_PAYMENT_STATUS,
    PERMISSION_IDS.CREATE_BOOKING,
    PERMISSION_IDS.EDIT_BOOKING,
    PERMISSION_IDS.VIEW_REPORTS,
  ],
  coordinator: [
    PERMISSION_IDS.VIEW_SCHEDULES,
    PERMISSION_IDS.REGISTER_VISITORS,
    PERMISSION_IDS.VIEW_REPORTS,
  ],
  employee: [PERMISSION_IDS.VIEW_SCHEDULES],
  admin_user: [
    PERMISSION_IDS.MANAGE_BOOKINGS,
    PERMISSION_IDS.VIEW_REPORTS,
    PERMISSION_IDS.CREATE_BOOKING,
    PERMISSION_IDS.EDIT_BOOKING,
    PERMISSION_IDS.VIEW_SCHEDULES,
  ],
  customer_admin: [
    PERMISSION_IDS.MANAGE_BOOKINGS,
    PERMISSION_IDS.VIEW_REPORTS,
    PERMISSION_IDS.MANAGE_EMPLOYEES,
    PERMISSION_IDS.MANAGE_SHIFTS,
    PERMISSION_IDS.CREATE_BOOKING,
    PERMISSION_IDS.EDIT_BOOKING,
    PERMISSION_IDS.CANCEL_BOOKING,
    PERMISSION_IDS.VIEW_SCHEDULES,
    PERMISSION_IDS.REGISTER_VISITORS,
    PERMISSION_IDS.SELL_PACKAGES,
  ],
};

export function getLegacyPermissionsForRole(role: string): PermissionId[] {
  return LEGACY_ROLE_PERMISSIONS[role] ?? [];
}

export function legacyRoleHasPermission(role: string, permissionId: string): boolean {
  const perms = LEGACY_ROLE_PERMISSIONS[role] ?? [];
  return perms.includes(permissionId as PermissionId);
}

/**
 * Resolve permission IDs for a user.
 * - tenant_admin and solution_owner always get full permissions (all pages), regardless of role_id.
 * - When role_id is set for other roles: return ONLY permissions from role_permissions.
 * - When role_id is null/undefined: use legacy role mapping.
 */
export async function getPermissionsForUser(
  supabaseClient: any,
  roleId: string | null | undefined,
  legacyRole: string
): Promise<string[]> {
  const role = (legacyRole || '').trim();
  if (role === 'tenant_admin' || role === 'solution_owner') {
    return [...ALL_PERMISSION_IDS];
  }
  if (roleId != null && String(roleId).trim() !== '') {
    const { data: rows, error } = await supabaseClient
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId);
    if (!error && rows) {
      return rows.map((r: { permission_id: string }) => r.permission_id);
    }
    return [];
  }
  return getLegacyPermissionsForRole(legacyRole) as string[];
}
