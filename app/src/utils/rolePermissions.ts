import type { AdminRole } from '@/types';

export const rolePermissions: Record<AdminRole, string[]> = {
  super_admin: ['*'], // Full access
  manager: [
    'overview',
    'customers',
    'shipments',
    'tracking',
    'invoices',
    'communications',
    'newsletter',
    'reports',
    'settings',
  ],
  logistics_officer: [
    'overview',
    'shipments',
    'tracking',
    'communications',
  ],
  finance_officer: [
    'overview',
    'invoices',
    'payments',
    'reports',
  ],
  crm_officer: [
    'overview',
    'customers',
    'newsletter',
    'audience_segmentation',
    'communications',
  ],
  support_staff: [
    'overview',
    'shipments',
    'communications',
  ],
};

export function hasModuleAccess(role: AdminRole | undefined | null, moduleName: string): boolean {
  if (!role) return false;
  const allowed = rolePermissions[role];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(moduleName);
}
