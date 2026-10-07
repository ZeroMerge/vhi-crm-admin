import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_TEMPLATES, EmailKind, renderTemplate, templateContext } from '../src/modules/email/templates';
import { SAMPLES, XSS, CAPPED_MESSAGES } from '../src/modules/email/templates/samples';
import { formatSentAt, selectMessages, MESSAGE_GROUP_MAX } from '../src/modules/email/templates/messages';
import { cleanSubject, escapeHtml, html, maskEmail, rawHtml, SUBJECT_MAX } from '../src/modules/email/templates/html';
import { buildUrl, normaliseBase } from '../src/modules/email/templates/urls';
import { unsubscribeConfirmPage, unsubscribeInvalidPage } from '../src/modules/email/templates/pages';

const BASES = { client: 'https://client.example.test', admin: 'https://admin.example.test', api: 'https://api.example.test' };
const ctxFor = (supportReplyTo = false) => templateContext({ bases: BASES, supportReplyTo, unsubscribeToken: 'TOKEN.SIG' });
const render = (kind: EmailKind, params: unknown, supportReplyTo = false) => renderTemplate(kind, params as never, ctxFor(supportReplyTo));
const sampleById = (id: string) => {
  const s = SAMPLES.find((x) => x.id === id);
  assert.ok(s, `sample ${id}`);
  return s!;
};
const renderSample = (id: string) => {
  const s = sampleById(id);
  return render(s.kind, s.params, s.supportReplyTo);
};
// Executable markup that must never appear in rendered HTML built from hostile input.
// (Escaped text such as "&lt;img onerror=…&gt;" is harmless; what matters is a real tag carrying an event handler.)
const DANGEROUS = [/<script/i, /<img/i, /<[^>]*\son[a-z]+\s*=/i, /href="javascript:/i, /<b>VHI<\/b>/];
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

describe('email html helpers', () => {
  test('html`` escapes every interpolation, including attributes and arrays; rawHtml is the only bypass', () => {
    const out = html`<a title="${XSS}">${[XSS, 1]}</a>${rawHtml('<br>')}`.value;
    assert.ok(!/<script|<img/i.test(out.replace('<a title=', '').replace('</a>', '').replace('<br>', '')));
    assert.ok(out.includes('&lt;script&gt;') && out.includes('&quot;quoted&quot;') && out.includes('&#39;single&#39;') && out.includes('&#96;tick&#96;'));
    assert.ok(out.endsWith('<br>'));
    assert.equal(escapeHtml('&<>"\'`'), '&amp;&lt;&gt;&quot;&#39;&#96;');
  });

  test('subjects: CR/LF, tab, NUL, DEL, C1 and Unicode line separators are removed; capped at 150 characters', () => {
    const nasty = `Hello\r\nBcc: victim@example.com\nX-Injected: 1\t${String.fromCharCode(0, 0x7f, 0x85, 0x2028, 0x2029)}end`;
    const s = cleanSubject(nasty);
    assert.ok(!/[\r\n\t]/.test(s));
    // eslint-disable-next-line no-control-regex
    assert.ok(![...s].some((c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f) || c === ' ' || c === ' '));
    assert.equal(s, 'Hello Bcc: victim@example.com X-Injected: 1 end');
    const long = cleanSubject('x'.repeat(400));
    assert.equal(Array.from(long).length, SUBJECT_MAX);
    assert.ok(long.endsWith('…'));
    const emoji = cleanSubject('😀'.repeat(200));
    assert.equal(Array.from(emoji).length, SUBJECT_MAX, 'never splits a surrogate pair');
  });

  test('maskEmail', () => {
    assert.equal(maskEmail('ada.obi@example.com'), 'a•••@example.com');
    assert.equal(maskEmail('broken'), '•••');
  });

  test('URLs: bases must be http(s) without query/fragment; segments and query values are encoded', () => {
    assert.equal(normaliseBase('X', 'https://app.example.com/'), 'https://app.example.com');
    assert.equal(normaliseBase('X', 'https://example.com/portal/'), 'https://example.com/portal');
    for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'not a url', 'https://example.com/?a=1', 'https://example.com/#x']) {
      assert.throws(() => normaliseBase('X', bad));
    }
    assert.equal(buildUrl('https://a.test', ['admin', '../../etc/passwd?x=1#y'], { q: 'a&b=c' }), 'https://a.test/admin/..%2F..%2Fetc%2Fpasswd%3Fx%3D1%23y?q=a%26b%3Dc');
  });
});

describe('email templates', () => {
  test('every template kind has at least one sample', () => {
    const covered = new Set(SAMPLES.map((s) => s.kind));
    for (const kind of Object.keys(EMAIL_TEMPLATES)) assert.ok(covered.has(kind as EmailKind), kind);
  });

  for (const s of SAMPLES) {
    test(`${s.id}: plaintext carries the same content and links as the HTML`, () => {
      const email = render(s.kind, s.params, s.supportReplyTo);
      assert.ok(email.subject.length > 0 && !/[\r\n]/.test(email.subject));
      assert.ok(email.html.startsWith('<!DOCTYPE html>'));
      for (const url of hrefs(email.html)) assert.ok(email.text.includes(url), `text is missing ${url}`);
      // Every visible sentence of the HTML (tags stripped, entities decoded) appears in the text version.
      const visible = email.html
        .replace(/<title>[\s\S]*?<\/title>/, '')
        .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/, '')
        .replace(/<br>/g, '\n')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#96;/g, '`').replace(/&amp;/g, '&')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && l !== 'VHI' && l !== '·' && !/^Or copy this link/.test(l));
      const flatText = email.text.replace(/\n> ?/g, '\n');
      for (const line of visible) {
        if (['Unsubscribe', 'Manage email settings', 'Settings → Notifications'].includes(line)) continue; // link labels; URLs checked above
        assert.ok(flatText.includes(line.replace(/\s+/g, ' ')) || flatText.replace(/\s+/g, ' ').includes(line.replace(/\s+/g, ' ')), `text is missing: ${line}`);
      }
    });
  }

  test('hostile input renders as text in HTML (names, subject, body, reason, order id, customer id, email)', () => {
    for (const id of ['x1-message-payload', 'x2-reason-payload', 'x3-support-payload']) {
      const email = renderSample(id);
      for (const re of DANGEROUS) assert.ok(!re.test(email.html), `${id} contains ${re}`);
      assert.ok(email.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), `${id} shows the payload as text`);
      assert.ok(!/[\r\n]/.test(email.subject));
      assert.ok(Array.from(email.subject).length <= SUBJECT_MAX);
    }
    const x2 = renderSample('x2-reason-payload');
    assert.ok(!x2.html.includes('"><img'), 'order id cannot break out of an attribute');
    assert.ok(x2.html.includes('order=%22%3E%3Cimg'), 'order id is URL-encoded in the tracking link');
    const x3 = renderSample('x3-support-payload');
    assert.ok(x3.html.includes('selected=..%2F..%2Fetc%2Fpasswd%3Fx%3D1%23y'));
    assert.equal(Array.from(x3.subject).length, SUBJECT_MAX);
  });

  test('message emails keep the FULL message, line by line (HTML <br>, text "> " quote)', () => {
    const email = renderSample('c7-message');
    const body = (sampleById('c7-message').params as { messages: Array<{ body: string }> }).messages[0].body;
    for (const line of body.split('\n').filter(Boolean)) {
      assert.ok(email.html.includes(escapeHtml(line)), `html missing ${line}`);
      assert.ok(email.text.includes(`> ${line}`), `text missing ${line}`);
    }
    assert.ok(email.html.includes('<br>Your pickup is booked'), 'line breaks kept');
    const long = 'word '.repeat(2000).trim();
    const big = render('customer.message', { firstname: 'Ada', count: 1, hasPortal: true, messages: [{ sentAt: '2026-10-06T14:00:00.000Z', subject: 's', body: long }] });
    assert.ok(big.text.includes(long), 'no truncation');
  });

  test('links: tracking deep link, client mail route (R-25), admin shipment, admin comms, verify/reset with token', () => {
    assert.ok(hrefs(renderSample('c5-in-transit').html).includes('https://client.example.test/dashboard/tracking?order=VHI-AF-104233'));
    const mail = hrefs(renderSample('c7-message').html);
    assert.ok(mail.includes('https://client.example.test/dashboard/mail'));
    assert.ok(!mail.some((u) => u.endsWith('/messages')));
    assert.ok(hrefs(renderSample('a1-shipment-created').html).includes('https://admin.example.test/admin/shipments/5b97855b-19f6-49c3-9a03-a7c057cb031c'));
    assert.ok(hrefs(renderSample('s1-support').html).includes('https://admin.example.test/admin/communications?selected=0b7c1f9e-0000-4000-8000-000000000001'));
    assert.ok(hrefs(renderSample('c1-verify').html).includes('https://client.example.test/verify-email?token=a1b2c3d4e5f6'));
    assert.ok(hrefs(renderSample('c2-reset').html).includes('https://client.example.test/reset-password?token=f6e5d4c3b2a1'));
  });

  test('unsubscribe link only on preference-gated customer emails; service emails have none', () => {
    for (const s of SAMPLES) {
      const email = render(s.kind, s.params, s.supportReplyTo);
      const hasUnsubscribe = hrefs(email.html).some((u) => u.startsWith('https://api.example.test/api/email/unsubscribe?token='));
      const isPreference = EMAIL_TEMPLATES[s.kind].preference === 'shipment_updates';
      assert.equal(hasUnsubscribe, isPreference, `${s.id}: unsubscribe ${hasUnsubscribe}`);
      assert.equal(email.text.includes('Unsubscribe:'), isPreference);
    }
    assert.throws(
      () => renderTemplate('customer.shipment_created', { firstname: 'A', orderId: 'X', status: 'pending' }, templateContext({ bases: BASES, supportReplyTo: false })),
      /unsubscribe token/
    );
  });

  test('cancel copy: reason quoted when given (customer-visible), fallback sentence otherwise; corrections have no template copy', () => {
    const withReason = renderSample('c5-cancelled-reason');
    assert.ok(withReason.text.includes('Reason:') && withReason.text.includes('> Goods are restricted for air freight.'));
    const noReason = renderSample('c5-cancelled-no-reason');
    assert.ok(noReason.text.includes('It will not be processed further.') && !noReason.text.includes('Reason:'));
  });

  test('password-changed mentions replying only when SUPPORT_EMAIL is set; admin reset email never mentions a password value', () => {
    assert.ok(renderSample('c3-password-changed').text.includes('replying to this email'));
    assert.ok(!renderSample('c3-password-changed-no-support').text.includes('replying'));
    const a4 = renderSample('a4-reset-by-admin');
    assert.ok(a4.text.includes('temporary password') && !/password:\s*\S/i.test(a4.text));
  });

  test('grouped messages: every message shown, oldest first, each with its sent time (customer and support inbox)', () => {
    for (const id of ['c7-message-grouped-3', 's1-support-grouped-3']) {
      const email = renderSample(id);
      const msgs = (sampleById(id).params as { messages: Array<{ body: string; sentAt: string }> }).messages;
      let last = -1;
      for (const m of msgs) {
        const firstLine = m.body.split(String.fromCharCode(10))[0];
        const at = email.text.indexOf(`> ${firstLine}`);
        assert.ok(at > last, `${id}: "${firstLine}" present and after the previous message`);
        last = at;
        assert.ok(email.text.includes(`Sent ${formatSentAt(m.sentAt)}`), `${id}: sent time shown`);
        assert.ok(email.html.includes(escapeHtml(firstLine)));
      }
      assert.ok(!email.text.includes('earlier message'), 'no cap note for a small group');
    }
    assert.equal(renderSample('c7-message-grouped-3').subject, '3 new messages from VHI');
    assert.equal(formatSentAt('2026-10-06T14:05:00.000Z'), '6 Oct 2026, 14:05 UTC');
    assert.equal(formatSentAt('not a date'), '');
  });

  test('grouped messages: the cap keeps the newest that fit 10 messages / 10,000 characters and says how many earlier ones are left out', () => {
    const { shown, earlier } = selectMessages(CAPPED_MESSAGES, 14);
    assert.deepEqual(shown.map((m) => m.subject), ['Update 9', 'Update 10', 'Update 11', 'Update 12', 'Update 13', 'Update 14']);
    assert.equal(earlier, 8);
    assert.ok(shown.reduce((n, m) => n + m.body.length, 0) <= 10_000);
    const tiny = Array.from({ length: 12 }, (_, i) => ({ sentAt: '2026-10-06T14:00:00.000Z', subject: `s${i}`, body: `b${i}` }));
    const capped = selectMessages(tiny, 12);
    assert.equal(capped.shown.length, MESSAGE_GROUP_MAX);
    assert.equal(capped.shown[0].subject, 's2', 'newest 10, oldest first');
    assert.equal(capped.earlier, 2);
    const huge = [{ sentAt: '2026-10-06T14:00:00.000Z', subject: 'x', body: 'y'.repeat(10_000) }];
    assert.equal(selectMessages(huge, 1).shown.length, 1, 'the newest message is always shown');

    const customer = renderSample('c7-message-capped');
    assert.ok(customer.text.includes('+8 earlier messages. Reply to this email or contact support to see them.'));
    assert.equal(customer.subject, '14 new messages from VHI');
    assert.ok(!customer.text.includes('> Short update 7.') && customer.text.includes('> Short update 14.'));
    assert.ok(customer.text.indexOf('Update 9') < customer.text.indexOf('Update 14'), 'oldest shown first');
    const support = renderSample('s1-support-capped');
    assert.ok(support.text.includes('+8 earlier messages. Open the conversation in the admin portal to see them.'));
  });

  test('"View conversation" only for customers with a portal account; leads get no portal button', () => {
    const active = renderSample('c7-message-grouped-3');
    assert.ok(active.text.includes('View conversation: https://client.example.test/dashboard/mail'));
    const lead = renderSample('c7-message-lead');
    assert.ok(!lead.text.includes('View conversation') && !hrefs(lead.html).some((u) => u.includes('/dashboard/')));
  });

  test('unsubscribe pages: GET confirmation is a POST form with no auto-submit; invalid page leaks nothing', () => {
    const page = unsubscribeConfirmPage({ maskedEmail: maskEmail('ada@example.com'), actionUrl: 'https://api.example.test/api/email/unsubscribe?token=T', settingsUrl: 'https://client.example.test/dashboard/settings' });
    assert.ok(page.includes('<form method="post" action="https://api.example.test/api/email/unsubscribe?token=T">'));
    assert.ok(!/<script|onload=|http-equiv="refresh"/i.test(page));
    assert.ok(page.includes('a•••@example.com') && !page.includes('ada@example.com'));
    const invalid = unsubscribeInvalidPage({ settingsUrl: 'https://client.example.test/dashboard/settings' });
    assert.ok(invalid.includes('invalid or has expired') && !/expired on|tampered|signature/i.test(invalid));
  });
});
