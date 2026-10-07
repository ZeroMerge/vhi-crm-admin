// One business time zone (APP_TIMEZONE, default Africa/Lagos) for the scheduler and every time shown in emails.
// Never the server's local zone. Formatting is deterministic for a given zone and Node/ICU build (retries render identically).

export const DEFAULT_TIMEZONE = 'Africa/Lagos';

/** Throws RangeError for an unknown IANA zone. */
export function assertTimezone(tz: string): string {
  new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(0);
  return tz;
}

/** APP_TIMEZONE or the default; throws for an invalid value (checked at startup by the email config). */
export function appTimezone(env: NodeJS.ProcessEnv = process.env): string {
  return assertTimezone(env.APP_TIMEZONE?.trim() || DEFAULT_TIMEZONE);
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tz}|${locale}|${JSON.stringify(options)}`;
  let f = partsCache.get(key);
  if (!f) partsCache.set(key, (f = new Intl.DateTimeFormat(locale, { ...options, timeZone: tz })));
  return f;
}

/** Wall-clock parts of an instant in `tz` (24-hour). */
export function zonedParts(date: Date, tz: string) {
  const parts = formatter(tz, 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Short zone label: "WAT" for Africa/Lagos (the en-NG locale names it), "BST", "UTC" or "GMT+n" elsewhere. */
export function zoneLabel(date: Date, tz: string): string {
  return formatter(tz, 'en-NG', { timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? tz;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "6 Oct 2026" in tz. */
export function formatDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "6 Oct 2026, 15:05 WAT" in tz; '' for an invalid date. */
export function formatDateTime(value: string | Date, tz: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = zonedParts(date, tz);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)} ${zoneLabel(date, tz)}`;
}

/** Calendar date "YYYY-MM-DD" of an instant in tz. */
export function localDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Offset of tz from UTC at an instant, in ms (local wall time minus UTC). */
function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when the local wall clock in tz shows `ymd` at hh:mm (handles DST by re-checking the offset). */
export function zonedTimeToInstant(ymd: string, hh: number, mm: number, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let instant = guess - offsetMs(new Date(guess), tz);
  instant = guess - offsetMs(new Date(instant), tz);
  return new Date(instant);
}

/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The next instant strictly after `now` when the clock in tz reads "HH:MM". */
export function nextDailyAt(now: Date, hhmm: string, tz: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  const today = localDate(now, tz);
  const candidate = zonedTimeToInstant(today, hh, mm, tz);
  return candidate.getTime() > now.getTime() ? candidate : zonedTimeToInstant(addDays(today, 1), hh, mm, tz);
}
