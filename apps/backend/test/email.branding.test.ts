import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { spawnSync } from 'child_process';
import { brandFromEnv, contrastWithWhite, DEFAULT_BRAND } from '../src/modules/email/templates/brand';
import { renderTemplate, templateContext } from '../src/modules/email/templates';
import { SAMPLES, XSS } from '../src/modules/email/templates/samples';
import { unsubscribeConfirmPage } from '../src/modules/email/templates/pages';
import { emailConfigFromEnv } from '../src/modules/email/config';

const BASES = { client: 'https://client.test', admin: 'https://admin.test', api: 'https://api.test' };
const sample = (id: string) => SAMPLES.find((s) => s.id === id)!;

describe('email branding (EMAIL_BRAND_COLOR / EMAIL_LOGO_URL / EMAIL_COMPANY_ADDRESS)', () => {
  test('valid values are used; malformed, low-contrast or non-https values warn and fall back (never fail startup)', () => {
    const warnings: string[] = [];
    const ok = brandFromEnv({ EMAIL_BRAND_COLOR: '#0b5394', EMAIL_LOGO_URL: 'https://cdn.example.com/vhi.png', EMAIL_COMPANY_ADDRESS: 'VHI Logistics Ltd | 12 Example Street | Lagos |' }, true, warnings);
    assert.deepEqual(ok, { color: '#0B5394', logoUrl: 'https://cdn.example.com/vhi.png', companyAddress: ['VHI Logistics Ltd', '12 Example Street', 'Lagos'] });
    assert.deepEqual(warnings, []);

    const w2: string[] = [];
    const bad = brandFromEnv({ EMAIL_BRAND_COLOR: 'purple', EMAIL_LOGO_URL: 'javascript:alert(1)' }, true, w2);
    assert.deepEqual(bad, { ...DEFAULT_BRAND, companyAddress: [] });
    assert.ok(w2.some((w) => w.includes('EMAIL_BRAND_COLOR must be a #RRGGBB')));
    assert.ok(w2.some((w) => w.includes('EMAIL_LOGO_URL must be an absolute https URL')));
    assert.ok(w2.some((w) => w.includes('EMAIL_COMPANY_ADDRESS is not set')), 'production nudges for a postal address');

    const w3: string[] = [];
    assert.equal(brandFromEnv({ EMAIL_BRAND_COLOR: '#FFFF00' }, false, w3).color, DEFAULT_BRAND.color, 'yellow fails contrast with white text');
    assert.match(w3[0], /too light/);
    assert.ok(contrastWithWhite(DEFAULT_BRAND.color) >= 4.5, 'the default passes');
    const w4: string[] = [];
    assert.equal(brandFromEnv({ EMAIL_LOGO_URL: 'http://localhost:3000/logo.png' }, true, w4).logoUrl, null, 'http logos only outside production');
    assert.equal(brandFromEnv({ EMAIL_LOGO_URL: 'http://localhost:3000/logo.png' }, false, []).logoUrl, 'http://localhost:3000/logo.png');
    assert.equal(brandFromEnv({ EMAIL_COMPANY_ADDRESS: 'a|b|c|d|e|f|g' }, false, []).companyAddress.length, 5);
  });

  test('the email config carries the brand and its warnings', () => {
    const cfg = emailConfigFromEnv({ NODE_ENV: 'development', EMAIL_BRAND_COLOR: '#123456' });
    assert.equal(cfg.brand.color, '#123456');
    assert.equal(emailConfigFromEnv({ NODE_ENV: 'development' }).brand.color, DEFAULT_BRAND.color);
  });

  test('branded emails: colour on button/header/quote, escaped logo image with alt text, escaped address in HTML and text', () => {
    const brand = { color: '#0B5394', logoUrl: 'https://cdn.example.com/logo.png?a=1&b="2"', companyAddress: [`VHI ${XSS}`, '12 Example Street'] };
    const ctx = templateContext({ bases: BASES, supportReplyTo: false, unsubscribeToken: 'T.S', brand });
    const s = sample('c5-cancelled-reason');
    const email = renderTemplate(s.kind, s.params as never, ctx);
    assert.ok(email.html.includes('background:#0B5394'), 'button uses the brand colour');
    assert.ok(email.html.includes('border-bottom:3px solid #0B5394'));
    assert.ok(email.html.includes('<img src="https://cdn.example.com/logo.png?a=1&amp;b=&quot;2&quot;" alt="VHI"'), 'logo URL escaped in the attribute');
    assert.ok(!email.html.includes('#7B2D8B'), 'no default colour left');
    assert.ok(email.html.includes('VHI &lt;script&gt;'), 'address escaped');
    assert.ok(!/<script/i.test(email.html));
    assert.ok(email.text.endsWith(`VHI ${XSS}\n12 Example Street\n`), 'address closes the text footer');

    const plain = renderTemplate(s.kind, s.params as never, templateContext({ bases: BASES, supportReplyTo: false, unsubscribeToken: 'T.S' }));
    assert.ok(plain.html.includes('>VHI</td></tr>') && !plain.html.includes('<img'), 'default: the VHI wordmark, no image');
  });

  test('unsubscribe pages follow the brand', () => {
    const page = unsubscribeConfirmPage({ maskedEmail: 'a•••@x.test', actionUrl: '/api/email/unsubscribe?token=t', settingsUrl: 'https://client.test/dashboard/settings', brand: { color: '#0B5394', logoUrl: 'https://cdn.example.com/l.png', companyAddress: [] } });
    assert.ok(page.includes('background: #0B5394') && page.includes('<img src="https://cdn.example.com/l.png" alt="VHI"'));
  });
});

describe('npm run email:send-test', () => {
  const backend = path.join(__dirname, '..');
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, [path.join(backend, 'node_modules/tsx/dist/cli.mjs'), path.join(backend, 'src/modules/email/sendTest.ts'), ...args], {
      cwd: __dirname, // no .env here: the real apps/backend/.env is never loaded by these tests
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });

  test('refuses NODE_ENV=production, a missing --to, a bad address and an unknown template', () => {
    const prod = run(['--to', 'me@example.test', '--template', 'customer.message'], { NODE_ENV: 'production', EMAIL_PROVIDER: 'console' });
    assert.equal(prod.status, 1);
    assert.match(prod.stderr, /refuses to run with NODE_ENV=production/);
    const noTo = run(['--template', 'customer.message'], { NODE_ENV: 'development' });
    assert.equal(noTo.status, 1);
    assert.match(noTo.stderr, /Missing --to/);
    const badTo = run(['--to', 'not-an-address', '--template', 'customer.message'], { NODE_ENV: 'development' });
    assert.equal(badTo.status, 1);
    const unknown = run(['--to', 'me@example.test', '--template', 'nope'], { NODE_ENV: 'development' });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown template "nope"[\s\S]*customer\.verify_email/);
  });

  test('sends one sample through the configured provider and prints its message id (console provider here)', () => {
    const ok = run(['--to', 'me@example.test', '--template', 'c7-message-grouped-3'], { NODE_ENV: 'development', EMAIL_PROVIDER: 'console' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /to: me@example\.test/);
    assert.match(ok.stdout, /subject: \[Test\] 3 new messages from VHI/);
    assert.match(ok.stdout, /provider: console/);
    assert.match(ok.stdout, /message id: console-\d+-1/);
    const pref = run(['--to', 'me@example.test', '--template', 'customer.shipment_status'], { NODE_ENV: 'development', EMAIL_PROVIDER: 'console' });
    assert.equal(pref.status, 0, pref.stderr);
    assert.match(pref.stdout, /Unsubscribe: http:\/\/localhost:\d+\/api\/email\/unsubscribe\?token=/);
  });
});
