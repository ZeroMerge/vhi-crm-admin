import type { AdminRole } from '@/types';

export const rolePermissions: Record<AdminRole, string[]> = {
  super_admin: ['*'], 
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
    'shipments',
    'tracking',
    'communications',
  ],
  finance_officer: [
    'customers',
    'invoices',
    'payments',
    'reports',
  ],
  crm_officer: [
    'customers',
    'newsletter',
    'audience_segmentation',
    'communications',
  ],
  support_staff: [
    'customers',
    'shipments',
    'communications',
    'reports',
  ],
};

export function hasModuleAccess(role: AdminRole | undefined | null, moduleName: string): boolean {
  if (!role) return false;
  const allowed = rolePermissions[role];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(moduleName);
}
