import { z } from 'zod';
import { appTimezone } from '../../utils/appTime';
import { isValidDateString } from './dateRange';
import { FilterIssue, INDUSTRIES, SHIPPING_MODES, STATUS_GROUPS, STATUS_GROUP_STATUSES, StatusGroup } from './filters';

// Extra, additive filters for the existing Shipments and Invoices list endpoints, so a report figure can open the list behind it
// (docs/REPORTS.md "Drill-down"). Nothing existing changes: every parameter is optional and validated here (400 on bad input).
// Dates are LOCAL dates in APP_TIMEZONE, inclusive: the same convention as the reports, unlike the older dateFrom/dateTo
// (raw timestamps, end-exclusive at midnight, browser-zone).

const date = z.string().refine(isValidDateString, 'must be a real date, YYYY-MM-DD');
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');
const industry = z.enum([...INDUSTRIES, 'none']);

const shipmentExtras = z.object({
  createdFrom: date.optional(),
  createdTo: date.optional(),
  /** Which timestamp createdFrom/createdTo bound: 'created' (created_at, default) or 'status_changed' (status_changed_at). */
  dateField: z.enum(['created', 'status_changed']).default('created'),
  statusGroup: z.enum(STATUS_GROUPS).optional(),
  excludeDraft: flag.optional(),
  industry: industry.optional(),
});

const invoiceExtras = z.object({
  issuedFrom: date.optional(),
  issuedTo: date.optional(),
  paidFrom: date.optional(),
  paidTo: date.optional(),
  excludeDraft: flag.optional(),
  hasOutstanding: flag.optional(),
  industry: industry.optional(),
  mode: z.enum(SHIPPING_MODES).optional(),
});

export type ShipmentListExtras = z.infer<typeof shipmentExtras>;
export type InvoiceListExtras = z.infer<typeof invoiceExtras>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: FilterIssue[] };

function pick(query: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (query[k] !== undefined && query[k] !== '') out[k] = query[k];
  return out;
}

function parse<S extends z.ZodTypeAny>(schema: S, keys: string[], query: Record<string, unknown>, pairs: Array<[string, string]>): Parsed<z.infer<S>> {
  const parsed = schema.safeParse(pick(query, keys));
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ field: i.path.join('.') || 'query', message: i.message })) };
  const issues: FilterIssue[] = [];
  const v = parsed.data as Record<string, string | undefined>;
  for (const [from, to] of pairs) if (v[from] && v[to] && v[from]! > v[to]!) issues.push({ field: from, message: `must not be after ${to}` });
  return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data };
}

export const parseShipmentListExtras = (query: Record<string, unknown>) =>
  parse(shipmentExtras, Object.keys(shipmentExtras.shape), query, [['createdFrom', 'createdTo']]);

export const parseInvoiceListExtras = (query: Record<string, unknown>) =>
  parse(invoiceExtras, Object.keys(invoiceExtras.shape), query, [['issuedFrom', 'issuedTo'], ['paidFrom', 'paidTo']]);

/** [from 00:00 local, day after `to` 00:00 local) as SQL on the caller's params array (`params.push` returns the new $n). */
function bounds(column: string, from: string | undefined, to: string | undefined, params: unknown[], tz: string): string[] {
  const out: string[] = [];
  const zone = () => `${`$${params.push(tz)}`}::text`;
  if (from) out.push(`${column} >= ((${`$${params.push(from)}`}::date)::timestamp AT TIME ZONE ${zone()})`);
  if (to) out.push(`${column} < (((${`$${params.push(to)}`}::date) + 1)::timestamp AT TIME ZONE ${zone()})`);
  return out;
}

/** Conditions for the shipments list (aliases s = shipments, c = customers). The caller must reset its paramIdx to params.length + 1. */
export function shipmentListConditions(x: ShipmentListExtras, params: unknown[], tz: string = appTimezone()): string[] {
  const where: string[] = [];
  where.push(...bounds(x.dateField === 'status_changed' ? 's.status_changed_at' : 's.created_at', x.createdFrom, x.createdTo, params, tz));
  if (x.excludeDraft) where.push(`s.status <> 'draft'`);
  if (x.statusGroup) where.push(`s.status::text = ANY($${params.push(STATUS_GROUP_STATUSES[x.statusGroup as StatusGroup])}::text[])`);
  if (x.industry === 'none') where.push(`c.industry IS NULL`);
  else if (x.industry) where.push(`c.industry = $${params.push(x.industry)}::industry_enum`);
  return where;
}

/** Conditions for the invoices list (aliases i = invoices, c = customers, s = shipments). Same paramIdx rule. */
export function invoiceListConditions(x: InvoiceListExtras, params: unknown[], tz: string = appTimezone()): string[] {
  const where: string[] = [];
  where.push(...bounds('i.issued_at', x.issuedFrom, x.issuedTo, params, tz));
  if (x.paidFrom || x.paidTo) {
    const paid = bounds('COALESCE(py.paid_at, py.created_at)', x.paidFrom, x.paidTo, params, tz);
    where.push(`EXISTS (SELECT 1 FROM payments py WHERE py.invoice_id = i.id AND py.payment_status = 'success' AND ${paid.join(' AND ')})`);
  }
  if (x.excludeDraft) where.push(`i.status <> 'draft'`);
  if (x.hasOutstanding) {
    where.push(`i.amount > COALESCE((SELECT sum(py.amount) FROM payments py WHERE py.invoice_id = i.id AND py.payment_status = 'success'), 0)`);
  }
  if (x.industry === 'none') where.push(`c.industry IS NULL`);
  else if (x.industry) where.push(`c.industry = $${params.push(x.industry)}::industry_enum`);
  if (x.mode) where.push(`s.shipping_mode = $${params.push(x.mode)}::shipping_mode_enum`);
  return where;
}
