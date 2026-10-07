import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  ROLE_MODULES,
  CROSS_READS,
  enforcementMode,
  moduleGuard,
  roleHasAnyModule,
  roleHasModule,
  rolesWithModule,
} from '../src/middleware/permissions';
import { supportStaffMayWrite } from '../src/middleware/adminMiddleware';

// Sync strategy: a parity test (not a shared file). The backend compiles to CommonJS with rootDir ./src and the
// admin UI is a separate Vite app, so sharing one source file would change both build setups.
async function loadUiRolePermissions(): Promise<Record<string, string[]>> {
  const file = path.join(__dirname, '../../../app/src/utils/rolePermissions.ts');
  const mod = await import(pathToFileURL(file).href);
  return mod.rolePermissions;
}

describe('role map parity with the admin UI', () => {
  test('ROLE_MODULES equals app/src/utils/rolePermissions.ts exactly', async () => {
    const ui = await loadUiRolePermissions();
    const sortMap = (m: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
    assert.deepEqual(sortMap(ROLE_MODULES), sortMap(ui));
  });
});

describe('module helpers', () => {
  test('roleHasModule: super_admin wildcard, unknown/empty roles have nothing', () => {
    assert.equal(roleHasModule('super_admin', 'anything'), true);
    assert.equal(roleHasModule('manager', 'invoices'), true);
    assert.equal(roleHasModule('logistics_officer', 'invoices'), false);
    assert.equal(roleHasModule('staff', 'shipments'), false);
    assert.equal(roleHasModule(undefined, 'shipments'), false);
    assert.equal(roleHasModule('', 'shipments'), false);
    assert.equal(roleHasAnyModule('support_staff', ['invoices', 'reports']), true);
  });

  test('rolesWithModule lists every role that can see a module (for notification routing)', () => {
    assert.deepEqual(rolesWithModule('payments').sort(), ['finance_officer', 'super_admin']);
    assert.deepEqual(rolesWithModule('tracking').sort(), ['logistics_officer', 'manager', 'super_admin']);
    assert.deepEqual(rolesWithModule('team'), ['super_admin']);
    assert.deepEqual(rolesWithModule('settings').sort(), Object.keys(ROLE_MODULES).sort());
  });

  test('cross-reads are the four approved ones and always include the owning module', () => {
    assert.deepEqual(CROSS_READS.customersList, ['customers', 'shipments']);
    assert.deepEqual(CROSS_READS.invoicesList, ['invoices', 'reports']);
    assert.deepEqual(CROSS_READS.communicationsThread, ['communications', 'customers']);
    assert.deepEqual(CROSS_READS.trackingNote, ['tracking', 'shipments']);
  });

  test('PERMISSION_ENFORCEMENT: only "log" switches to log mode; unset/other values enforce', () => {
    const saved = process.env.PERMISSION_ENFORCEMENT;
    try {
      for (const [value, expected] of [[undefined, 'enforce'], ['enforce', 'enforce'], ['log', 'log'], ['LOG', 'enforce'], ['', 'enforce'], ['off', 'enforce']] as const) {
        if (value === undefined) delete process.env.PERMISSION_ENFORCEMENT;
        else process.env.PERMISSION_ENFORCEMENT = value;
        assert.equal(enforcementMode(), expected, String(value));
      }
    } finally {
      if (saved === undefined) delete process.env.PERMISSION_ENFORCEMENT;
      else process.env.PERMISSION_ENFORCEMENT = saved;
    }
  });
});

describe('moduleGuard exceptions match exact method + path only', () => {
  const guard = moduleGuard('customers', [{ method: 'GET', path: '/', anyOf: ['customers', 'shipments'] }]);
  function run(method: string, reqPath: string, role: string): number | 'next' {
    let result: number | 'next' = 'next';
    const req: any = { method, path: reqPath, baseUrl: '/api/admin/customers', admin: { id: 'x', activeRole: role } };
    const res: any = { status: (code: number) => { result = code; return { json: () => undefined }; } };
    guard(req, res, () => { result = 'next'; });
    return result;
  }
  test('logistics may list customers but nothing else on the router', () => {
    delete process.env.PERMISSION_ENFORCEMENT;
    assert.equal(run('GET', '/', 'logistics_officer'), 'next');
    assert.equal(run('GET', '', 'logistics_officer'), 'next');
    assert.equal(run('POST', '/', 'logistics_officer'), 403);
    assert.equal(run('GET', '/abc', 'logistics_officer'), 403);
    assert.equal(run('GET', '/abc/shipments', 'logistics_officer'), 403);
    assert.equal(run('GET', '/abc', 'crm_officer'), 'next');
  });

  test(':param matches exactly one non-empty segment', () => {
    const g = moduleGuard('communications', [{ method: 'GET', path: '/:customerId', anyOf: ['communications', 'customers'] }]);
    const call = (p: string) => {
      let r: number | 'next' = 'next';
      g({ method: 'GET', path: p, baseUrl: '', admin: { id: 'x', activeRole: 'finance_officer' } } as any,
        { status: (c: number) => { r = c; return { json: () => undefined }; } } as any, () => { r = 'next'; });
      return r;
    };
    assert.equal(call('/123'), 'next');
    assert.equal(call('/'), 403);
    assert.equal(call('/123/extra'), 403);
  });
});

describe('support_staff write scope (R-20)', () => {
  const cases: Array<[string, string, boolean]> = [
    ['POST', '/api/admin/customers', true],
    ['POST', '/api/admin/customers/', true],
    ['PUT', '/api/admin/customers/abc', true],
    ['PUT', '/api/admin/customers/abc/star', false],
    ['PUT', '/api/admin/customers/abc/status', false],
    ['PUT', '/api/admin/customers/abc/segment', false],
    ['DELETE', '/api/admin/customers/abc', false],
    ['POST', '/api/admin/customers/abc', false],
    ['PUT', '/api/auth/admin/change-password', true],
    ['PUT', '/api/auth/admin/profile', true],
    ['PUT', '/api/auth/admin/notification-preferences', true],
    ['POST', '/api/auth/admin/switch-role', true],
    ['POST', '/api/auth/admin/logout', true],
    ['PUT', '/api/admin/shipments/abc/status', false],
    ['POST', '/api/admin/communications/send', false],
    ['POST', '/api/admin/communications/abc/read', true],
    ['POST', '/api/admin/communications/abc/read/x', false],
    ['DELETE', '/api/admin/communications/abc', false],
    ['POST', '/api/admin/customersX', false],
    ['PUT', '/api/admin/admins/abc/roles', false],
  ];
  for (const [method, p, ok] of cases) {
    test(`${method} ${p} → ${ok ? 'allowed' : 'blocked'}`, () => assert.equal(supportStaffMayWrite(method, p), ok));
  }
});
