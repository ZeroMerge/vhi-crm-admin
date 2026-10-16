import { z } from 'zod';
import { appTimezone, zonedParts } from '../../utils/appTime';
import {
  GRANULARITIES, Granularity, MAX_BUCKETS, MAX_RANGE_DAYS, RANGE_PRESETS, RangePreset,
  autoGranularity, buildBuckets, daysBetween, isValidDateString, resolvePreset,
} from './dateRange';

export const INDUSTRIES = ['oil_gas', 'medical_pharma', 'agricultural', 'manufacturing', 'mining', 'others'] as const;
export const SHIPPING_MODES = ['air_freight', 'groupage', 'consolidation', 'china_groupage', 'cargo_clearing', 'export', 'sea_freight'] as const;

export const STATUS_GROUPS = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];
/** Draft belongs to no group: reports never count drafts. */
export const STATUS_GROUP_STATUSES: Record<StatusGroup, string[]> = {
  pending: ['pending'],
  in_progress: ['processing', 'in_transit', 'clearance'],
  completed: ['delivered'],
  cancelled: ['cancelled'],
};

export interface ReportFilters {
  range: RangePreset;
  /** Resolved, inclusive local dates in `timezone`. */
  from: string;
  to: string;
  granularity: Granularity;
  timezone: string;
  customerId?: string;
  /** An industry enum value, or 'none' for customers with no industry. */
  industry?: string;
  statusGroup?: StatusGroup;
  mode?: string;
  /** Upper-case currency code. */
  currency?: string;
}

const dateString = z.string().refine(isValidDateString, 'must be a real date, YYYY-MM-DD');

const filtersSchema = z
  .object({
    range: z.enum(RANGE_PRESETS as [RangePreset, ...RangePreset[]]).default('this_month'),
    from: dateString.optional(),
    to: dateString.optional(),
    granularity: z.enum(GRANULARITIES as [Granularity, ...Granularity[]]).optional(),
    customerId: z.string().uuid().optional(),
    industry: z.enum([...INDUSTRIES, 'none']).optional(),
    statusGroup: z.enum(STATUS_GROUPS).optional(),
    mode: z.enum(SHIPPING_MODES).optional(),
    currency: z.string().regex(/^[A-Za-z]{3,10}$/, 'must be a currency code such as NGN').transform((v) => v.toUpperCase()).optional(),
  })
  .strict();

export interface FilterIssue {
  field: string;
  message: string;
}

export type FilterResult = { ok: true; filters: ReportFilters } | { ok: false; issues: FilterIssue[] };

/** Empty values (a UI that always sends every key) count as absent. */
function dropBlank(query: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) if (v !== '' && v !== undefined) out[k] = v;
  return out;
}

export function todayIn(timezone: string, now: Date = new Date()): string {
  const p = zonedParts(now, timezone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Validates the shared filter query and resolves it: presets become concrete local dates, the granularity is chosen
 * when absent, and the range and bucket caps are enforced. Everything invalid is reported at once.
 */
export function parseFilters(query: Record<string, unknown>, options: { now?: Date; timezone?: string } = {}): FilterResult {
  const parsed = filtersSchema.safeParse(dropBlank(query));
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'query', message: i.message })) };
  }
  const q = parsed.data;
  const timezone = options.timezone ?? appTimezone();
  const issues: FilterIssue[] = [];

  let from: string;
  let to: string;
  if (q.range === 'custom') {
    if (!q.from) issues.push({ field: 'from', message: 'is required when range=custom' });
    if (!q.to) issues.push({ field: 'to', message: 'is required when range=custom' });
    from = q.from ?? '';
    to = q.to ?? '';
  } else {
    if (q.from || q.to) issues.push({ field: q.from ? 'from' : 'to', message: 'is only allowed with range=custom' });
    ({ from, to } = resolvePreset(q.range, todayIn(timezone, options.now)));
  }
  if (issues.length) return { ok: false, issues };

  if (from > to) return { ok: false, issues: [{ field: 'from', message: 'must not be after "to"' }] };
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
    return { ok: false, issues: [{ field: 'to', message: `range is limited to 10 years (${MAX_RANGE_DAYS} days)` }] };
  }

  const granularity = q.granularity ?? autoGranularity(from, to);
  if (buildBuckets(from, to, granularity).length > MAX_BUCKETS) {
    return { ok: false, issues: [{ field: 'granularity', message: `would produce more than ${MAX_BUCKETS} periods; choose a coarser granularity or a shorter range` }] };
  }

  return {
    ok: true,
    filters: {
      range: q.range, from, to, granularity, timezone,
      customerId: q.customerId, industry: q.industry, statusGroup: q.statusGroup, mode: q.mode, currency: q.currency,
    },
  };
}

// ---- list parameters (pagination, sorting, search) ----

export interface ListParams {
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
  q?: string;
}

export function parseListParams(
  query: Record<string, unknown>,
  allowedSorts: readonly string[],
  defaultSort: string,
): { ok: true; list: ListParams } | { ok: false; issues: FilterIssue[] } {
  const schema = z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.string().refine((s) => allowedSorts.includes(s), `must be one of: ${allowedSorts.join(', ')}`).default(defaultSort),
    dir: z.enum(['asc', 'desc']).default('asc'),
    q: z.string().trim().max(100).optional(),
  });
  const parsed = schema.safeParse(dropBlank(query));
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'query', message: i.message })) };
  }
  return { ok: true, list: parsed.data };
}

/** Keys that belong to the list parameters, so the strict filter schema can ignore them when both are read from one query. */
export const LIST_KEYS = ['page', 'pageSize', 'sort', 'dir', 'q'] as const;

export function withoutListKeys(query: Record<string, unknown>): Record<string, unknown> {
  const out = { ...query };
  for (const k of LIST_KEYS) delete out[k];
  return out;
}
