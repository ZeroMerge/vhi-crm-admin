// Calendar maths for reports on plain 'YYYY-MM-DD' strings (local dates in APP_TIMEZONE). No Date-in-local-zone arithmetic: every
// date is handled as a UTC midnight, so the server's own zone and DST never matter here. The SQL side converts the same local
// dates to instants with AT TIME ZONE (see sql.ts).

export type Granularity = 'day' | 'week' | 'month' | 'year';
export const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year'];
export type RangePreset = 'this_week' | 'this_month' | 'this_year' | 'last_30_days' | 'custom';
export const RANGE_PRESETS: RangePreset[] = ['this_week', 'this_month', 'this_year', 'last_30_days', 'custom'];

export const MAX_RANGE_DAYS = 3653; // 10 years
export const MAX_BUCKETS = 400;

const MS_DAY = 86_400_000;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parse(s);
  return !Number.isNaN(d.getTime()) && fmt(d) === s;
}

export function addDays(s: string, n: number): string {
  return fmt(new Date(parse(s).getTime() + n * MS_DAY));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / MS_DAY);
}

/** Monday of the ISO week containing `s`. */
export function startOfIsoWeek(s: string): string {
  const dow = (parse(s).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(s, -dow);
}

export function startOfMonth(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s: string): string {
  const d = parse(s);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function startOfYear(s: string): string {
  return `${s.slice(0, 4)}-01-01`;
}

export function bucketStart(s: string, g: Granularity): string {
  switch (g) {
    case 'day': return s;
    case 'week': return startOfIsoWeek(s);
    case 'month': return startOfMonth(s);
    case 'year': return startOfYear(s);
  }
}

/** Last day (inclusive) of the bucket that starts at `start`. */
export function bucketEnd(start: string, g: Granularity): string {
  switch (g) {
    case 'day': return start;
    case 'week': return addDays(start, 6);
    case 'month': return endOfMonth(start);
    case 'year': return `${start.slice(0, 4)}-12-31`;
  }
}

function nextBucketStart(start: string, g: Granularity): string {
  return addDays(bucketEnd(start, g), 1);
}

/** ISO 8601 week label for a date, e.g. 2026-W41 (the ISO year can differ from the calendar year around 1 January). */
export function isoWeekLabel(s: string): string {
  const monday = parse(startOfIsoWeek(s));
  const thursday = new Date(monday.getTime() + 3 * MS_DAY);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = parse(startOfIsoWeek(fmt(jan4)));
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * MS_DAY)) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function bucketLabel(start: string, g: Granularity): string {
  switch (g) {
    case 'day': return start;
    case 'week': return isoWeekLabel(start);
    case 'month': return start.slice(0, 7);
    case 'year': return start.slice(0, 4);
  }
}

export interface Bucket {
  /** First day of the bucket (the key the SQL returns). */
  start: string;
  label: string;
  /** The bucket clipped to the report range, inclusive: the dates a drill-down link should carry. */
  from: string;
  to: string;
  /** True when the report range cuts the bucket (first or last bucket). */
  partial: boolean;
}

/** Every bucket from `from` to `to`, empty ones included. Stops (and reports the overflow) past `limit`. */
export function buildBuckets(from: string, to: string, g: Granularity, limit = MAX_BUCKETS + 1): Bucket[] {
  const out: Bucket[] = [];
  let start = bucketStart(from, g);
  while (start <= to && out.length < limit) {
    const end = bucketEnd(start, g);
    const clippedFrom = start < from ? from : start;
    const clippedTo = end > to ? to : end;
    out.push({ start, label: bucketLabel(start, g), from: clippedFrom, to: clippedTo, partial: clippedFrom !== start || clippedTo !== end });
    start = nextBucketStart(start, g);
  }
  return out;
}

export function autoGranularity(from: string, to: string): Granularity {
  const days = daysBetween(from, to) + 1;
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  if (days <= 3 * 366) return 'month';
  return 'year';
}

export function resolvePreset(preset: Exclude<RangePreset, 'custom'>, today: string): { from: string; to: string } {
  switch (preset) {
    case 'this_week': return { from: startOfIsoWeek(today), to: today };
    case 'this_month': return { from: startOfMonth(today), to: today };
    case 'this_year': return { from: startOfYear(today), to: today };
    case 'last_30_days': return { from: addDays(today, -29), to: today };
  }
}
