// `npm run email:preview`: renders every email template (and the unsubscribe pages) with sample data into
// apps/backend/.email-preview/ (git-ignored) and prints the index path. No database, no env, no sending.
// Includes hostile samples (markup and header-injection payloads) so escaping can be checked by eye.
import fs from 'fs';
import path from 'path';
import { EMAIL_TEMPLATES, renderTemplate, templateContext } from './templates';
import { SAMPLES } from './templates/samples';
import { escapeHtml, maskEmail } from './templates/html';
import { links } from './templates/urls';
import { unsubscribeConfirmPage, unsubscribeDonePage, unsubscribeInvalidPage } from './templates/pages';

const BASES = { client: 'https://client.example.test', admin: 'https://admin.example.test', api: 'https://api.example.test' };
const OUT = path.resolve(__dirname, '../../../.email-preview');

function write(file: string, content: string) {
  fs.writeFileSync(path.join(OUT, file), content, 'utf8');
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const rows: string[] = [];

  for (const s of SAMPLES) {
    const ctx = templateContext({ bases: BASES, supportReplyTo: Boolean(s.supportReplyTo), unsubscribeToken: 'SAMPLE.TOKEN' });
    const email = renderTemplate(s.kind, s.params as never, ctx);
    write(`${s.id}.html`, email.html);
    write(`${s.id}.txt`, email.text);
    const def = EMAIL_TEMPLATES[s.kind];
    rows.push(`<section>
<h2>${escapeHtml(s.id)} <small>${escapeHtml(s.kind)}</small></h2>
<p class="meta"><b>Subject:</b> ${escapeHtml(email.subject)}<br><b>Audience:</b> ${def.audience} · <b>Preference:</b> ${def.preference ?? 'none (service email)'} · ${escapeHtml(s.note)}<br>
<a href="${s.id}.html" target="_blank">Open HTML</a> · <a href="${s.id}.txt" target="_blank">Open text</a></p>
<div class="frames"><figure><figcaption>Desktop (600px)</figcaption><iframe src="${s.id}.html" width="600" height="620" loading="lazy" sandbox></iframe></figure>
<figure><figcaption>Mobile (375px)</figcaption><iframe src="${s.id}.html" width="375" height="620" loading="lazy" sandbox></iframe></figure>
<figure><figcaption>Plain text</figcaption><pre>${escapeHtml(email.text)}</pre></figure></div>
</section>`);
  }

  // Branded example (EMAIL_BRAND_COLOR / EMAIL_LOGO_URL / EMAIL_COMPANY_ADDRESS). The logo is an inline SVG so the preview works offline;
  // real config only accepts https URLs.
  const demoLogo = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32"><rect width="96" height="32" rx="6" fill="#0B5394"/><text x="48" y="22" font-family="Arial" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">VHI</text></svg>').toString('base64');
  const brand = { color: '#0B5394', logoUrl: demoLogo, companyAddress: ['VHI Logistics Ltd', '12 Example Street, Lagos, Nigeria'] };
  for (const id of ['c5-delivered', 'c7-message-grouped-3']) {
    const s = SAMPLES.find((x) => x.id === id)!;
    const email = renderTemplate(s.kind, s.params as never, templateContext({ bases: BASES, supportReplyTo: false, unsubscribeToken: 'SAMPLE.TOKEN', brand }));
    write(`branded-${id}.html`, email.html);
    write(`branded-${id}.txt`, email.text);
    rows.push(`<section><h2>branded-${id} <small>EMAIL_BRAND_COLOR=#0B5394, logo, company address</small></h2><p class="meta"><b>Subject:</b> ${escapeHtml(email.subject)}<br><a href="branded-${id}.html" target="_blank">Open HTML</a> · <a href="branded-${id}.txt" target="_blank">Open text</a></p>
<div class="frames"><figure><figcaption>Desktop (600px)</figcaption><iframe src="branded-${id}.html" width="600" height="620" loading="lazy" sandbox></iframe></figure>
<figure><figcaption>Mobile (375px)</figcaption><iframe src="branded-${id}.html" width="375" height="620" loading="lazy" sandbox></iframe></figure></div></section>`);
  }

  const l = links(BASES);
  const action = l.unsubscribe('SAMPLE.TOKEN');
  const pages: Array<[string, string]> = [
    ['page-unsubscribe-confirm', unsubscribeConfirmPage({ maskedEmail: maskEmail('ada.obi@example.com'), actionUrl: action, settingsUrl: l.clientSettings() })],
    ['page-unsubscribe-done', unsubscribeDonePage({ settingsUrl: l.clientSettings() })],
    ['page-unsubscribe-invalid', unsubscribeInvalidPage({ settingsUrl: l.clientSettings() })],
  ];
  for (const [id, markup] of pages) {
    write(`${id}.html`, markup);
    rows.push(`<section><h2>${id} <small>web page</small></h2><p class="meta"><a href="${id}.html" target="_blank">Open page</a></p>
<div class="frames"><figure><figcaption>Desktop</figcaption><iframe src="${id}.html" width="600" height="420" loading="lazy" sandbox></iframe></figure>
<figure><figcaption>Mobile (375px)</figcaption><iframe src="${id}.html" width="375" height="420" loading="lazy" sandbox></iframe></figure></div></section>`);
  }

  write(
    'index.html',
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>VHI email previews</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#fafafa;color:#1a1a1a}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:0 0 24px}
h2{margin:0 0 8px;font-size:18px} h2 small{font-weight:400;color:#666;font-size:13px}
.meta{font-size:13px;color:#333;margin:0 0 12px}
.frames{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0} figcaption{font-size:12px;color:#666;margin-bottom:4px}
iframe{border:1px solid #ccc;background:#fff}
pre{width:420px;max-height:620px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#f4f4f4;border:1px solid #ccc;padding:12px;margin:0;font-size:12px}
</style></head><body>
<h1>VHI email previews</h1>
<p>${SAMPLES.length} emails (${Object.keys(EMAIL_TEMPLATES).length} templates) and 3 unsubscribe pages, rendered with sample data. Links point at example.test bases.
Samples starting with <b>x</b> carry hostile input and must show it as plain text. Iframes are sandboxed (no scripts run).</p>
${rows.join('\n')}
</body></html>`
  );

  console.log(`Email previews written to ${OUT}`);
  console.log(`Open: file:///${path.join(OUT, 'index.html').replace(/\\/g, '/')}`);
}

main();
