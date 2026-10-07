// Shared email layout. Templates describe an email as blocks; this file renders the same blocks to HTML and to plain text,
// so the two versions always carry the same content. Templates never write markup themselves.
import { cleanSubject, html, rawHtml, SafeHtml } from './html';

export type Block =
  | { kind: 'p'; text: string }
  /** User-written text (messages, reasons). Line breaks are kept. */
  | { kind: 'quote'; text: string }
  | { kind: 'details'; rows: Array<[label: string, value: string]> }
  /** showUrl: also print the URL under the button (account links that must survive a broken button). */
  | { kind: 'button'; label: string; url: string; showUrl?: boolean };

export type Footer =
  | { kind: 'service' }
  | { kind: 'preference'; unsubscribeUrl: string; settingsUrl: string }
  | { kind: 'staff'; settingsUrl?: string };

export interface EmailDoc {
  subject: string;
  /** Inbox preview line (hidden in the body). */
  preheader: string;
  greeting?: string;
  blocks: Block[];
  footer: Footer;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = '#7B2D8B';
const TEXT = '#1A1A1A';
const MUTED = '#6B6470';
const BORDER = '#E7E1EA';
const PAGE_BG = '#F4F2F5';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');

function blockHtml(block: Block): SafeHtml {
  switch (block.kind) {
    case 'p':
      return html`<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${TEXT};">${block.text}</p>`;
    case 'quote': {
      const body = lines(block.text).map((line, i) => (i === 0 ? html`${line}` : html`<br>${line}`));
      return html`<div style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${BRAND};background:#FAF7FB;font-size:15px;line-height:1.55;color:${TEXT};word-break:break-word;">${body}</div>`;
    }
    case 'details':
      return html`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">${block.rows.map(
        ([label, value]) =>
          html`<tr><td style="padding:4px 16px 4px 0;font-size:14px;color:${MUTED};white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 0;font-size:14px;font-weight:600;color:${TEXT};word-break:break-word;overflow-wrap:anywhere;">${value}</td></tr>`
      )}</table>`;
    case 'button':
      return html`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 ${block.showUrl ? '12px' : '24px'};"><tr><td style="border-radius:6px;background:${BRAND};"><a href="${block.url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">${block.label}</a></td></tr></table>${
        block.showUrl
          ? html`<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:${MUTED};word-break:break-all;">Or copy this link into your browser:<br><a href="${block.url}" style="color:${BRAND};">${block.url}</a></p>`
          : ''
      }`;
  }
}

function footerHtml(footer: Footer): SafeHtml {
  const p = (content: SafeHtml) => html`<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${MUTED};">${content}</p>`;
  switch (footer.kind) {
    case 'service':
      return p(html`This is a service email about your VHI account.`);
    case 'preference':
      return html`${p(html`You're receiving this because shipment update emails are on.`)}${p(
        html`<a href="${footer.unsubscribeUrl}" style="color:${MUTED};">Unsubscribe</a> · <a href="${footer.settingsUrl}" style="color:${MUTED};">Manage email settings</a>`
      )}`;
    case 'staff':
      return html`${p(html`Automated message from VHI CRM.`)}${
        footer.settingsUrl ? p(html`Turn these emails off in <a href="${footer.settingsUrl}" style="color:${MUTED};">Settings → Notifications</a>.`) : ''
      }`;
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'p':
      return block.text;
    case 'quote':
      return lines(block.text)
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'details':
      return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    case 'button':
      return `${block.label}: ${block.url}`;
  }
}

function footerText(footer: Footer): string {
  switch (footer.kind) {
    case 'service':
      return 'This is a service email about your VHI account.';
    case 'preference':
      return `You're receiving this because shipment update emails are on.\nUnsubscribe: ${footer.unsubscribeUrl}\nManage email settings: ${footer.settingsUrl}`;
    case 'staff':
      return `Automated message from VHI CRM.${footer.settingsUrl ? `\nTurn these emails off in Settings → Notifications: ${footer.settingsUrl}` : ''}`;
  }
}

export function renderEmail(doc: EmailDoc): RenderedEmail {
  const subject = cleanSubject(doc.subject);
  const content = [...(doc.greeting ? [{ kind: 'p', text: doc.greeting } as Block] : []), ...doc.blocks];

  const body = html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:${rawHtml(FONT)};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${doc.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${BORDER};border-radius:8px;">
<tr><td style="padding:18px 28px;border-bottom:3px solid ${BRAND};font-size:20px;font-weight:700;letter-spacing:0.5px;color:${BRAND};">VHI</td></tr>
<tr><td style="padding:28px 28px 8px;font-family:${rawHtml(FONT)};">${content.map(blockHtml)}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:16px 28px;font-family:${rawHtml(FONT)};">${footerHtml(doc.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [...content.map(blockText), '--', footerText(doc.footer)].join('\n\n') + '\n';
  return { subject, html: body.value, text };
}
