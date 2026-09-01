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
    'audience_segmentation',
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
    'shipments',
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

export function hasModuleAccess(role: AdminRole | string | undefined | null, moduleName: string): boolean {
  if (!role) return false;
  const allowed = rolePermissions[role as AdminRole];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(moduleName);
}

export function getDefaultRouteForRole(role: AdminRole | string | undefined | null): string {
  if (!role) return '/admin/login';
  switch (role) {
    case 'super_admin':
    case 'manager':
      return '/admin';
    case 'logistics_officer':
      return '/admin/shipments';
    case 'finance_officer':
      return '/admin/invoices';
    case 'crm_officer':
    case 'support_staff':
      return '/admin/customers';
    default:
      return '/admin/customers';
  }
}
