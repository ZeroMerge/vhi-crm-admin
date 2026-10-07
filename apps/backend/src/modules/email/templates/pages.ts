// Unsubscribe web pages served by GET/POST /api/email/unsubscribe. Same look as the emails; plain HTML, no scripts.
import { html, rawHtml, SafeHtml } from './html';

const BRAND = '#7B2D8B';
const TEXT = '#1A1A1A';
const MUTED = '#6B6470';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function page(title: string, body: SafeHtml): string {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · VHI</title>
<style>
  body { margin: 0; background: #F4F2F5; font-family: ${rawHtml(FONT)}; color: ${TEXT}; }
  main { max-width: 480px; margin: 40px auto; padding: 0 16px; }
  .card { background: #FFFFFF; border: 1px solid #E7E1EA; border-radius: 8px; overflow: hidden; }
  .brand { padding: 16px 24px; border-bottom: 3px solid ${BRAND}; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; color: ${BRAND}; }
  .content { padding: 24px; }
  h1 { margin: 0 0 12px; font-size: 20px; line-height: 1.3; }
  p { margin: 0 0 14px; font-size: 15px; line-height: 1.55; }
  .muted { color: ${MUTED}; font-size: 14px; }
  button { font: inherit; font-size: 15px; font-weight: 600; color: #FFFFFF; background: ${BRAND}; border: 0; border-radius: 6px; padding: 12px 22px; cursor: pointer; }
  button:focus-visible, a:focus-visible { outline: 3px solid #E91E8C; outline-offset: 2px; }
  a { color: ${BRAND}; }
</style>
</head>
<body>
<main>
<div class="card">
<div class="brand">VHI</div>
<div class="content">${body}</div>
</div>
</main>
</body>
</html>`.value;
}

/** GET: asks for confirmation and changes nothing (mail scanners prefetch links). */
export function unsubscribeConfirmPage(opts: { maskedEmail: string; actionUrl: string; settingsUrl: string }): string {
  return page(
    'Unsubscribe',
    html`<h1>Unsubscribe from shipment update emails?</h1>
<p>You'll stop getting emails about new shipments, status changes and tracking numbers for <strong>${opts.maskedEmail}</strong>.</p>
<p class="muted">You'll still see these updates in your VHI dashboard, and account and message emails still arrive.</p>
<form method="post" action="${opts.actionUrl}"><button type="submit">Unsubscribe</button></form>
<p class="muted" style="margin-top:20px;">Changed your mind? Just close this page. You can also <a href="${opts.settingsUrl}">manage your email settings</a>.</p>`
  );
}

export function unsubscribeDonePage(opts: { settingsUrl: string }): string {
  return page(
    'Unsubscribed',
    html`<h1>You're unsubscribed</h1>
<p>You won't get shipment update emails any more.</p>
<p class="muted">You can turn them back on in your <a href="${opts.settingsUrl}">email settings</a>.</p>`
  );
}

export function unsubscribeInvalidPage(opts: { settingsUrl: string }): string {
  return page(
    'Link not valid',
    html`<h1>This link isn't valid</h1>
<p>This unsubscribe link is invalid or has expired.</p>
<p class="muted">You can change your email settings in your <a href="${opts.settingsUrl}">VHI dashboard</a>.</p>`
  );
}
