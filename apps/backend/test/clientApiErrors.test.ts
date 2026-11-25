import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// The client app has no test runner, so its pure helpers are loaded and tested here (like help.test.ts).
// [FB1-1] field-level validation messages, [FB1-2] login/register/forgot/reset 401s, [FB1-3] Specialized Groupage origins.
const CLIENT = path.join(__dirname, '../../../../client/src');
const load = (file: string): any => require(path.join(CLIENT, file)); // eslint-disable-line @typescript-eslint/no-require-imports
const read = (file: string) => fs.readFileSync(path.join(CLIENT, file), 'utf8');

const { isAuthRequest, isFailureBody, loginErrorMessage, serverFieldErrors, hasValidationDetail, GENERIC_LOGIN_ERROR } = load('lib/apiErrors.ts');
const { SPECIALIZED_GROUPAGE_ORIGINS, SHIPPING_MODES, joinWithAnd } = load('lib/shippingModes.ts');

const err = (status: number, data: unknown, url?: string, code?: string) => ({ code, config: { url }, response: { status, data } });

describe('isAuthRequest: which 401s must not sign the user out', () => {
  test('login, register, forgot, reset and verify (with or without /api, query string or host) are auth requests', () => {
    for (const url of [
      '/client/auth/login', '/client/auth/register', '/client/auth/forgot-password', '/client/auth/reset-password', '/client/auth/verify-email?token=abc',
      '/api/client/auth/login', 'https://vhi-crm-admin.onrender.com/api/client/auth/login', 'http://localhost:5001/api/client/auth/register',
    ]) assert.equal(isAuthRequest(url), true, url);
  });

  test('every other request keeps the "session expired" behaviour', () => {
    for (const url of ['/client/shipments', '/client/communications', '/client/notifications/unread-count', '/client/auth/login/extra', '/client/auth', '', undefined, null])
      assert.equal(isAuthRequest(url as any), false, String(url));
  });

  test('the interceptor and handleError both use it (source check)', () => {
    assert.match(read('lib/api.ts'), /status === 401 && !isAuthRequest\(error\.config\?\.url\)/);
    assert.match(read('lib/helper.ts'), /!isAuthRequest\(error\.config\?\.url\)/);
  });
});

describe('loginErrorMessage: generic, never reveals whether the account exists', () => {
  test('wrong password and unknown email give the same sentence', () => {
    assert.equal(loginErrorMessage(err(401, { success: false, message: 'Invalid credentials' })), GENERIC_LOGIN_ERROR);
    assert.equal(GENERIC_LOGIN_ERROR, 'Incorrect email or password');
    assert.equal(loginErrorMessage(err(401, undefined)), GENERIC_LOGIN_ERROR);
    assert.equal(loginErrorMessage(err(401, { message: 'invalid credentials' })), GENERIC_LOGIN_ERROR);
  });
  test('other outcomes keep their own message', () => {
    assert.equal(loginErrorMessage(err(401, { success: false, message: 'Account not verified. Please check your email.' })), 'Account not verified. Please check your email.');
    assert.equal(loginErrorMessage(err(500, { message: 'boom' })), 'Server Error, please try again later.');
    assert.equal(loginErrorMessage(err(0, undefined, undefined, 'ERR_NETWORK')), 'Network Error');
    assert.equal(loginErrorMessage(err(400, { message: 'Email and password are required' })), 'Email and password are required');
  });
  test('the sign-in page shows it in the form (role=alert) and the hook passes it on', () => {
    assert.match(read('pages/signin/SignIn.tsx'), /role="alert"/);
    assert.match(read('pages/signin/SignIn.tsx'), /onFailure: setLoginError/);
    assert.match(read('lib/api.ts'), /loginErrorMessage\(error as AppError\)/);
  });
});

describe('error shape: success:false (backend) and status:false (old Laravel) are both failures', () => {
  test('isFailureBody', () => {
    assert.equal(isFailureBody({ success: false }), true);
    assert.equal(isFailureBody({ status: false }), true);
    assert.equal(isFailureBody({ success: true }), false);
    assert.equal(isFailureBody(undefined), false);
  });
});

describe('serverFieldErrors: field messages next to the fields', () => {
  const body = { success: false, message: 'Validation failed', errors: { originAddress: ['Required'], natureOfItem: ['natureOfItem is required'], weight: ['Expected number'] } };

  test('maps server names to the form names and keeps the first message', () => {
    const r = serverFieldErrors(err(400, body), ['description', 'originAddress', 'weight'], { natureOfItem: 'description' });
    assert.deepEqual(r.fields, { originAddress: 'Required', description: 'natureOfItem is required', weight: 'Expected number' });
    assert.deepEqual(r.general, []);
  });

  test('a server field the form does not have is not lost: it goes to `general`', () => {
    const r = serverFieldErrors(err(400, body), ['description'], { natureOfItem: 'description' });
    assert.deepEqual(r.fields, { description: 'natureOfItem is required' });
    assert.deepEqual(r.general.sort(), ['originAddress: Required', 'weight: Expected number']);
  });

  test('the zod flatten() shape used for item errors is read too', () => {
    const r = serverFieldErrors(err(400, { success: false, message: 'Invalid items', errors: { formErrors: ['Expected array'], fieldErrors: { '0': ['bad'] } } }), [], {});
    assert.deepEqual(r.general.sort(), ['0: bad', 'Expected array']);
  });

  test('no details, odd shapes: nothing is thrown', () => {
    for (const e of [err(400, { success: false, message: 'x' }), err(400, undefined), err(400, { errors: 'text' }), err(400, { errors: null }), {}]) {
      const r = serverFieldErrors(e as any, ['a'], {});
      assert.deepEqual(r, { fields: {}, general: [] });
      assert.equal(hasValidationDetail(e as any), false);
    }
    assert.equal(hasValidationDetail(err(400, body)), true);
  });

  test('every create form passes its error to applyServerFieldErrors', () => {
    for (const f of ['AirFreightForm', 'SeaFreightForm', 'GroupageForm', 'ExportForm', 'AirFreightConsolidationForm', 'SpecializedGroupageForm', 'CargoClearingForm'])
      assert.match(read(`pages/dashboard/create-shipment/${f}.tsx`), /onError: \(error\) => applyServerFieldErrors\(error, form,/, f);
  });
});

describe('[FB1-3] Specialized Groupage origins: one list', () => {
  test('China, Germany and UK; the card text is built from the same list', () => {
    assert.deepEqual([...SPECIALIZED_GROUPAGE_ORIGINS], ['China', 'Germany', 'UK']);
    assert.equal(joinWithAnd(SPECIALIZED_GROUPAGE_ORIGINS), 'China, Germany, and UK');
    assert.equal(joinWithAnd(['A', 'B']), 'A and B');
    const card = SHIPPING_MODES.find((m: any) => m.id === 'specialized-groupage');
    assert.ok(card.description.includes('China, Germany, and UK'));
  });
  test('the form renders its dropdown from the list, with no hard-coded country', () => {
    const src = read('pages/dashboard/create-shipment/SpecializedGroupageForm.tsx');
    assert.match(src, /SPECIALIZED_GROUPAGE_ORIGINS\.map/);
    assert.doesNotMatch(src, /<SelectItem value="(China|Germany|UK)">/);
  });
  test('Belgium is not an origin (waiting for the client to confirm)', () => {
    assert.ok(!SPECIALIZED_GROUPAGE_ORIGINS.includes('Belgium'));
  });
});
