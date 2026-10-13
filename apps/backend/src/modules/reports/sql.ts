import { GRANULARITIES, Granularity } from './dateRange';
import { ReportFilters, STATUS_GROUP_STATUSES } from './filters';

// SQL building blocks shared by the report queries. Every value goes through $n placeholders (Params); the only text spliced into
// SQL is a granularity that was checked against the whitelist, fixed column names, and sort columns picked from a whitelist.

export class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Instants for the report range: [local 00:00 of `from`, local 00:00 of the day after `to`) in the report's time zone. */
export function rangeBounds(p: Params, f: ReportFilters): { tz: string; lo: string; hi: string } {
  const tz = `${p.add(f.timezone)}::text`;
  const lo = `((${p.add(f.from)}::date)::timestamp AT TIME ZONE ${tz})`;
  const hi = `(((${p.add(f.to)}::date) + 1)::timestamp AT TIME ZONE ${tz})`;
  return { tz, lo, hi };
}

/** 'YYYY-MM-DD' of the bucket start in the report's time zone. date_trunc('week') starts on Monday (ISO). */
export function bucketSql(column: string, g: Granularity, tz: string): string {
  if (!GRANULARITIES.includes(g)) throw new Error(`invalid granularity ${g}`);
  return `to_char(date_trunc('${g}', ${column} AT TIME ZONE ${tz}), 'YYYY-MM-DD')`;
}

/** Currency codes are compared trimmed and upper-cased so 'ngn' and 'NGN ' are one currency. */
export const currencySql = (column: string) => `upper(btrim(${column}))`;

export const customerNameSql = (alias: string) => `btrim(concat_ws(' ', ${alias}.firstname, ${alias}.lastname))`;

/** Money leaves SQL as exact decimal text with 2 places ("1234.50"): no float rounding anywhere on the server. */
export const money = (expr: string) => `coalesce(${expr}, 0)::numeric(15,2)::text`;

export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Customer conditions on alias `c` (customers). */
export function customerConditions(p: Params, f: ReportFilters, alias = 'c'): string[] {
  const where: string[] = [];
  if (f.industry === 'none') where.push(`${alias}.industry IS NULL`);
  else if (f.industry) where.push(`${alias}.industry = ${p.add(f.industry)}::industry_enum`);
  return where;
}

/** Shipment conditions on alias `s`, with the customer's industry on alias `c`. Drafts are always excluded. */
export function shipmentConditions(p: Params, f: ReportFilters): string[] {
  const where = [`s.status <> 'draft'`];
  if (f.customerId) where.push(`s.customer_id = ${p.add(f.customerId)}::uuid`);
  if (f.mode) where.push(`s.shipping_mode = ${p.add(f.mode)}::shipping_mode_enum`);
  if (f.statusGroup) where.push(`s.status::text = ANY(${p.add(STATUS_GROUP_STATUSES[f.statusGroup])}::text[])`);
  where.push(...customerConditions(p, f));
  return where;
}

/**
 * The shipment events of the report range, as CTEs `sh` and `ev` (columns: customer_id, at, kind, status).
 *  - kind 'created': the shipment was created in range (status = its CURRENT status: the created-in-range snapshot).
 *  - kind 'delivered' / 'cancelled': the shipment is in that status and got there in range (status_changed_at).
 */
export function shipmentEventsCte(p: Params, f: ReportFilters): { sql: string; tz: string } {
  const { tz, lo, hi } = rangeBounds(p, f);
  const sql = `
    sh AS (
      SELECT s.id, s.customer_id, s.status, s.created_at, s.status_changed_at
        FROM shipments s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE ${shipmentConditions(p, f).join(' AND ')}
    ),
    ev AS (
      SELECT customer_id, created_at AS at, 'created'::text AS kind, status::text AS status
        FROM sh WHERE created_at >= ${lo} AND created_at < ${hi}
      UNION ALL
      SELECT customer_id, status_changed_at, status::text, status::text
        FROM sh WHERE status IN ('delivered', 'cancelled') AND status_changed_at >= ${lo} AND status_changed_at < ${hi}
    )`;
  return { sql, tz };
}

/** The five shipment counters over `ev`, as aggregate expressions. */
export const SHIPMENT_COUNTERS = `
  count(*) FILTER (WHERE kind = 'created')::int AS created,
  count(*) FILTER (WHERE kind = 'created' AND status = 'pending')::int AS pending,
  count(*) FILTER (WHERE kind = 'created' AND status IN ('processing', 'in_transit', 'clearance'))::int AS in_progress,
  count(*) FILTER (WHERE kind = 'delivered')::int AS completed,
  count(*) FILTER (WHERE kind = 'cancelled')::int AS cancelled`;

/** Invoice conditions on alias `i` (non-draft, issued), with customer on `c` and shipment on `sx`. */
export function invoiceConditions(p: Params, f: ReportFilters, currency: string | null | undefined = f.currency): string[] {
  const where = [`i.status <> 'draft'`, `i.issued_at IS NOT NULL`];
  if (f.customerId) where.push(`i.customer_id = ${p.add(f.customerId)}::uuid`);
  if (f.mode) where.push(`sx.shipping_mode = ${p.add(f.mode)}::shipping_mode_enum`);
  if (currency) where.push(`${currencySql('i.currency')} = ${p.add(currency)}::text`);
  where.push(...customerConditions(p, f));
  return where;
}

export const INVOICE_FROM = `invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN shipments sx ON sx.id = i.shipment_id`;

/** Successful payments on alias `p` (payments), with the invoice on `i`, customer on `c`, shipment on `sx`. */
export function paymentConditions(p: Params, f: ReportFilters, currency: string | null | undefined = f.currency): string[] {
  const where = [`py.payment_status = 'success'`];
  if (f.customerId) where.push(`py.customer_id = ${p.add(f.customerId)}::uuid`);
  if (f.mode) where.push(`sx.shipping_mode = ${p.add(f.mode)}::shipping_mode_enum`);
  if (currency) where.push(`${currencySql('py.currency')} = ${p.add(currency)}::text`);
  where.push(...customerConditions(p, f));
  return where;
}

export const PAYMENT_FROM = `payments py LEFT JOIN invoices i ON i.id = py.invoice_id LEFT JOIN customers c ON c.id = py.customer_id LEFT JOIN shipments sx ON sx.id = i.shipment_id`;

/** When a payment counts: its paid_at, else (older rows that never got one) its created_at. Matches payments_success_paid_idx. */
export const PAYMENT_DATE = `COALESCE(py.paid_at, py.created_at)`;

/** Per-invoice amount still unpaid (success payments only, never negative). Needs the `pd` join below. */
export const OPEN_AMOUNT = `GREATEST(i.amount - COALESCE(pd.paid, 0), 0)`;
export const PAID_JOIN = `LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM payments WHERE payment_status = 'success' GROUP BY invoice_id) pd ON pd.invoice_id = i.id`;
