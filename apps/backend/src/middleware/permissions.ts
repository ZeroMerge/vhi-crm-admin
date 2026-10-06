import { Request, Response, NextFunction, RequestHandler } from 'express';
import pool from '../config/db';

// Server-side mirror of app/src/utils/rolePermissions.ts (the admin UI's module access).
// test/permissions.test.ts fails if the two drift apart.
export const ROLE_MODULES: Record<string, string[]> = {
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
  logistics_officer: ['shipments', 'tracking', 'communications', 'settings'],
  finance_officer: ['customers', 'shipments', 'invoices', 'payments', 'reports', 'settings'],
  crm_officer: ['customers', 'newsletter', 'audience_segmentation', 'communications', 'settings'],
  support_staff: ['customers', 'shipments', 'communications', 'reports', 'settings'],
};

export function roleHasModule(role: string | null | undefined, module: string): boolean {
  const allowed = role ? ROLE_MODULES[role] : undefined;
  if (!allowed) return false;
  return allowed.includes('*') || allowed.includes(module);
}

export function roleHasAnyModule(role: string | null | undefined, modules: string[]): boolean {
  return modules.some((m) => roleHasModule(role, m));
}

// Roles that can see a module; the notification layer routes recipients with this.
export function rolesWithModule(module: string): string[] {
  return Object.keys(ROLE_MODULES).filter((role) => roleHasModule(role, module));
}

// Approved cross-module reads (Phase 0, Item 6 audit): pages that read another module's list.
//   Shipments → Compose loads the customers list (logistics_officer has no customers module)
//   Reports page loads the invoices list (support_staff has no invoices module)
//   CustomerDetail loads a communications thread (finance_officer has no communications module)
//   ShipmentDetail "Add note" posts a tracking note (finance_officer/support_staff have no tracking module)
// Search result groups use the same rules (see READABLE_LIST).
export const CROSS_READS = {
  customersList: ['customers', 'shipments'],
  invoicesList: ['invoices', 'reports'],
  communicationsThread: ['communications', 'customers'],
  trackingNote: ['tracking', 'shipments'],
  shipmentsList: ['shipments'],
};

export type EnforcementMode = 'enforce' | 'log';

// PERMISSION_ENFORCEMENT=log logs module denials and lets the request through (rollout); anything else enforces.
export function enforcementMode(): EnforcementMode {
  return process.env.PERMISSION_ENFORCEMENT === 'log' ? 'log' : 'enforce';
}

function denyOrLog(req: Request, res: Response, next: NextFunction, modules: string[]) {
  if (enforcementMode() === 'log') {
    console.warn(
      JSON.stringify({
        event: 'permission_denied',
        mode: 'log',
        adminId: req.admin?.id ?? null,
        activeRole: req.admin?.activeRole ?? null,
        method: req.method,
        route: `${req.baseUrl}${req.path}`,
        module: modules.join('|'),
      })
    );
    return next();
  }
  return res.status(403).json({ success: false, message: 'You do not have access to this module' });
}

export function requireAnyModule(modules: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (roleHasAnyModule(req.admin.activeRole, modules)) return next();
    return denyOrLog(req, res, next, modules);
  };
}

export function requireModule(module: string): RequestHandler {
  return requireAnyModule([module]);
}

export interface ModuleException {
  method: string;
  // Router-relative path; `:name` matches exactly one segment, everything else must match exactly.
  path: string;
  anyOf: string[];
}

function pathMatches(pattern: string, actual: string): boolean {
  const norm = (p: string) => p.replace(/\/+$/, '') || '/';
  const a = norm(pattern).split('/');
  const b = norm(actual).split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => (seg.startsWith(':') ? b[i].length > 0 : seg === b[i]));
}

// Router-level guard: every route needs `module`, except exact method+path pairs listed in `exceptions`.
export function moduleGuard(module: string, exceptions: ModuleException[] = []): RequestHandler {
  return (req, res, next) => {
    const exception = exceptions.find((e) => e.method === req.method && pathMatches(e.path, req.path));
    return requireAnyModule(exception ? exception.anyOf : [module])(req, res, next);
  };
}

// ---- Account state (ALWAYS enforced, independent of PERMISSION_ENFORCEMENT) ----

interface AccountState {
  isActive: boolean;
  deleted: boolean;
  assignedRoles: string[];
}

const ACCOUNT_CACHE_TTL_MS = 30_000;
const accountCache = new Map<string, { state: AccountState | null; expires: number }>();

// Up to 30s staleness per process is the trade-off for one less query per request.
export function clearAdminAccountCache(adminId?: string) {
  if (adminId) accountCache.delete(adminId);
  else accountCache.clear();
}

async function loadAccountState(adminId: string): Promise<AccountState | null> {
  const hit = accountCache.get(adminId);
  if (hit && hit.expires > Date.now()) return hit.state;
  const { rows } = await pool.query(
    'SELECT is_active, deleted_at, assigned_roles FROM admins WHERE id = $1',
    [adminId]
  );
  const state = rows[0]
    ? { isActive: rows[0].is_active !== false, deleted: rows[0].deleted_at !== null, assignedRoles: rows[0].assigned_roles || [] }
    : null;
  accountCache.set(adminId, { state, expires: Date.now() + ACCOUNT_CACHE_TTL_MS });
  return state;
}

// Runs after adminMiddleware. 401 makes the admin UI log out (app/src/services/api.ts).
export const requireActiveAdmin: RequestHandler = async (req, res, next) => {
  if (!req.admin) return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    const state = await loadAccountState(req.admin.id);
    if (!state || !state.isActive || state.deleted || !state.assignedRoles.includes(req.admin.activeRole)) {
      return res.status(401).json({ success: false, message: 'Session is no longer valid. Please sign in again.' });
    }
    next();
  } catch (err) {
    next(err);
  }
};
