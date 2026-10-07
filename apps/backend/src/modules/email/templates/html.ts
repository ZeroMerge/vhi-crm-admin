// HTML helpers for email templates. Every interpolation is escaped unless it is already SafeHtml.
// The only way to inject markup is rawHtml(), which is reserved for fixed markup written in this folder.

export class SafeHtml {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
}

type Interpolation = SafeHtml | string | number | null | undefined | false | Interpolation[];

function toHtml(value: Interpolation): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  return escapeHtml(String(value));
}

/** Tagged template: literal parts are kept, every `${}` is escaped (arrays are escaped item by item). */
export function html(strings: TemplateStringsArray, ...values: Interpolation[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Marks fixed, trusted markup as safe. Never pass user or database values. */
export function rawHtml(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

// Control characters are built from code points at runtime so this source file never contains (or depends on the
// tooling preserving) escape sequences for them: C0 except tab, DEL + C1, and the Unicode line/paragraph separators.
const codeRange = (from: number, to: number) => String.fromCharCode(from) + '-' + String.fromCharCode(to);
const CONTROL_CHARS = new RegExp(
  `[${codeRange(0x00, 0x08)}${codeRange(0x0a, 0x1f)}${codeRange(0x7f, 0x9f)}${String.fromCharCode(0x2028, 0x2029)}]`,
  'g'
);

const flatten = (value: string) => value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();

export const SUBJECT_MAX = 150;

/** Header-safe subject: no CR/LF or other control characters, whitespace collapsed, capped at SUBJECT_MAX characters. */
export function cleanSubject(subject: string): string {
  const flat = flatten(subject);
  const chars = Array.from(flat); // code points, so the cut never splits a surrogate pair
  return chars.length <= SUBJECT_MAX ? flat : chars.slice(0, SUBJECT_MAX - 1).join('').trimEnd() + '…';
}

/** Single-line plain text (names, order ids) for use inside sentences and subjects. */
export function oneLine(value: string): string {
  return flatten(value);
}

/** a•••@example.com — enough for the owner to recognise their address on a page anyone with the link can open. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 1)}•••@${domain}`;
}
