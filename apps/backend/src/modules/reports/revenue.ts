import pool from '../../config/db';
import { buildBuckets } from './dateRange';
import { ListParams, ReportFilters } from './filters';
import {
  INVOICE_FROM, OPEN_AMOUNT, PAID_JOIN, PAYMENT_DATE, PAYMENT_FROM, Params,
  bucketSql, currencySql, customerNameSql, escapeLike, invoiceConditions, money, paymentConditions, rangeBounds,
} from './sql';

// Money is exact decimal text ("1234.50") end to end and never summed across currencies: every figure is keyed by currency.

export interface CurrencyFigures {
  /** Non-draft invoices issued in range, by issued_at. */
  invoiced: string;
  invoiceCount: number;
  /** Successful payments in range, by COALESCE(paid_at, created_at). */
  collected: string;
  paymentCount: number;
}

export interface RevenuePoint {
  bucket: string;
  label: string;
  from: string;
  to: string;
  partial: boolean;
  byCurrency: Record<string, CurrencyFigures>;
}

/** Invoiced and Collected per bucket and currency. Buckets with no money are returned with an empty byCurrency. */
export async function revenueSeries(f: ReportFilters): Promise<{ points: RevenuePoint[]; totals: Record<string, CurrencyFigures> }> {
  const p = new Params();
  const { tz, lo, hi } = rangeBounds(p, f);
  const invWhere = invoiceConditions(p, f).join(' AND ');
  const payWhere = paymentConditions(p, f).join(' AND ');
  const { rows } = await pool.query(
    `WITH ev AS (
       SELECT i.issued_at AS at, 'invoiced'::text AS kind, ${currencySql('i.currency')} AS cur, i.amount
         FROM ${INVOICE_FROM}
        WHERE ${invWhere} AND i.issued_at >= ${lo} AND i.issued_at < ${hi}
       UNION ALL
       SELECT ${PAYMENT_DATE}, 'collected', ${currencySql('py.currency')}, py.amount
         FROM ${PAYMENT_FROM}
        WHERE ${payWhere} AND ${PAYMENT_DATE} >= ${lo} AND ${PAYMENT_DATE} < ${hi}
     )
     SELECT ${bucketSql('at', f.granularity, tz)} AS bucket, cur,
            ${money(`sum(amount) FILTER (WHERE kind = 'invoiced')`)} AS invoiced,
            count(*) FILTER (WHERE kind = 'invoiced')::int AS invoice_count,
            ${money(`sum(amount) FILTER (WHERE kind = 'collected')`)} AS collected,
            count(*) FILTER (WHERE kind = 'collected')::int AS payment_count
       FROM ev GROUP BY 1, 2`,
    p.values,
  );

  const byBucket = new Map<string, Record<string, CurrencyFigures>>();
  for (const r of rows) {
    const cur = (byBucket.get(r.bucket) ?? {}) as Record<string, CurrencyFigures>;
    cur[r.cur] = { invoiced: r.invoiced, invoiceCount: r.invoice_count, collected: r.collected, paymentCount: r.payment_count };
    byBucket.set(r.bucket, cur);
  }
  const points = buildBuckets(f.from, f.to, f.granularity).map((b) => ({
    bucket: b.start, label: b.label, from: b.from, to: b.to, partial: b.partial, byCurrency: byBucket.get(b.start) ?? {},
  }));

  // Totals are summed in SQL, not in JS, so the cents stay exact.
  const t = new Params();
  const tb = rangeBounds(t, f);
  const totalRows = (
    await pool.query(
      `WITH ev AS (
         SELECT 'invoiced'::text AS kind, ${currencySql('i.currency')} AS cur, i.amount
           FROM ${INVOICE_FROM}
          WHERE ${invoiceConditions(t, f).join(' AND ')} AND i.issued_at >= ${tb.lo} AND i.issued_at < ${tb.hi}
         UNION ALL
         SELECT 'collected', ${currencySql('py.currency')}, py.amount
           FROM ${PAYMENT_FROM}
          WHERE ${paymentConditions(t, f).join(' AND ')} AND ${PAYMENT_DATE} >= ${tb.lo} AND ${PAYMENT_DATE} < ${tb.hi}
       )
       SELECT cur,
              ${money(`sum(amount) FILTER (WHERE kind = 'invoiced')`)} AS invoiced,
              count(*) FILTER (WHERE kind = 'invoiced')::int AS invoice_count,
              ${money(`sum(amount) FILTER (WHERE kind = 'collected')`)} AS collected,
              count(*) FILTER (WHERE kind = 'collected')::int AS payment_count
         FROM ev GROUP BY cur ORDER BY cur`,
      t.values,
    )
  ).rows;
  const totals: Record<string, CurrencyFigures> = {};
  for (const r of totalRows) totals[r.cur] = { invoiced: r.invoiced, invoiceCount: r.invoice_count, collected: r.collected, paymentCount: r.payment_count };
  return { points, totals };
}

export interface OutstandingFigures {
  /** Every non-draft invoice, whenever it was issued, as of now. Not date-bound. */
  openAll: string;
  openAllCount: number;
  /** The same, restricted to invoices issued in the report range. */
  issuedInRange: string;
  issuedInRangeCount: number;
}

/**
 * Outstanding per currency, computed from successful payments (never from invoice status).
 * The date range applies only to the issuedInRange figure; openAll honours customer, industry, mode and currency only.
 */
export async function outstanding(f: ReportFilters): Promise<Record<string, OutstandingFigures>> {
  const p = new Params();
  const { lo, hi } = rangeBounds(p, f);
  const { rows } = await pool.query(
    `SELECT cur,
            ${money('sum(open_amt)')} AS open_all, count(*)::int AS open_count,
            ${money('sum(open_amt) FILTER (WHERE in_range)')} AS cohort, (count(*) FILTER (WHERE in_range))::int AS cohort_count
       FROM (SELECT ${currencySql('i.currency')} AS cur, ${OPEN_AMOUNT} AS open_amt,
                    (i.issued_at >= ${lo} AND i.issued_at < ${hi}) AS in_range
               FROM ${INVOICE_FROM} ${PAID_JOIN}
              WHERE ${invoiceConditions(p, f).join(' AND ')}) t
      WHERE open_amt > 0
      GROUP BY cur ORDER BY cur`,
    p.values,
  );
  const out: Record<string, OutstandingFigures> = {};
  for (const r of rows) out[r.cur] = { openAll: r.open_all, openAllCount: r.open_count, issuedInRange: r.cohort, issuedInRangeCount: r.cohort_count };
  return out;
}

/** Counts that make the revenue figures less trustworthy; shown next to the cards. */
export async function dataQuality(): Promise<{ paymentsDatedByFallback: number; paidStatusWithOutstanding: number }> {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM payments WHERE payment_status = 'success' AND paid_at IS NULL)::int AS fallback,
            (SELECT count(*) FROM invoices i ${PAID_JOIN} WHERE i.status = 'paid' AND ${OPEN_AMOUNT} > 0)::int AS paid_open`,
  );
  return { paymentsDatedByFallback: rows[0].fallback, paidStatusWithOutstanding: rows[0].paid_open };
}

/** Currencies that occur on non-draft invoices or successful payments, most-used first. */
export async function currenciesInUse(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT cur FROM (
       SELECT ${currencySql('currency')} AS cur, count(*) AS n FROM invoices WHERE status <> 'draft' GROUP BY 1
       UNION ALL
       SELECT ${currencySql('currency')}, count(*) FROM payments WHERE payment_status = 'success' GROUP BY 1
     ) t WHERE cur IS NOT NULL AND cur <> '' GROUP BY cur ORDER BY sum(n) DESC, cur`,
  );
  return rows.map((r) => r.cur);
}

/** The currency a single-currency table shows: the filter's, else the most-used one, else NGN. */
export async function resolveCurrency(f: ReportFilters): Promise<{ currency: string; currencies: string[] }> {
  const currencies = await currenciesInUse();
  return { currency: f.currency ?? currencies[0] ?? 'NGN', currencies };
}

export const REVENUE_CUSTOMER_SORTS = ['name', 'invoiceCount', 'invoiced', 'collected', 'outstanding'] as const;
// Numeric expressions, not the text output columns: money is returned as text and would sort lexicographically.
const REVENUE_SORT_SQL: Record<string, string> = {
  name: 'name', invoiceCount: 'coalesce(inv.n, 0)', invoiced: 'coalesce(inv.amt, 0)', collected: 'coalesce(pay.amt, 0)', outstanding: 'coalesce(opn.open_all, 0)',
};

export interface RevenueCustomerRow {
  customerId: string | null;
  name: string;
  currency: string;
  invoiceCount: number;
  invoiced: string;
  collected: string;
  /** All open invoices of this customer as of now (not date-bound). */
  outstanding: string;
  /** Open amount of the invoices issued in range. */
  outstandingIssuedInRange: string;
}

/**
 * Invoiced, collected and outstanding per customer for ONE currency. Lists customers with any activity in range or an open balance.
 */
export async function revenueByCustomer(
  f: ReportFilters,
  list: ListParams,
  currency: string,
): Promise<{ rows: RevenueCustomerRow[]; total: number }> {
  const p = new Params();
  const { lo, hi } = rangeBounds(p, f);
  const search = list.q
    ? `AND (${customerNameSql('c')} ILIKE ${p.add(`%${escapeLike(list.q)}%`)} OR c.email ILIKE ${p.add(`%${escapeLike(list.q)}%`)})`
    : '';
  const invWhere = invoiceConditions(p, f, currency).join(' AND ');
  const payWhere = paymentConditions(p, f, currency).join(' AND ');
  const openWhere = invoiceConditions(p, f, currency).join(' AND ');
  const limit = p.add(list.pageSize);
  const offset = p.add((list.page - 1) * list.pageSize);
  const { rows } = await pool.query(
    `WITH inv AS (
       SELECT i.customer_id, count(*)::int AS n, sum(i.amount) AS amt
         FROM ${INVOICE_FROM} WHERE ${invWhere} AND i.issued_at >= ${lo} AND i.issued_at < ${hi} GROUP BY i.customer_id
     ), pay AS (
       SELECT py.customer_id, sum(py.amount) AS amt
         FROM ${PAYMENT_FROM} WHERE ${payWhere} AND ${PAYMENT_DATE} >= ${lo} AND ${PAYMENT_DATE} < ${hi} GROUP BY py.customer_id
     ), opn AS (
       SELECT customer_id, sum(open_amt) AS open_all, sum(open_amt) FILTER (WHERE in_range) AS cohort
         FROM (SELECT i.customer_id, ${OPEN_AMOUNT} AS open_amt, (i.issued_at >= ${lo} AND i.issued_at < ${hi}) AS in_range
                 FROM ${INVOICE_FROM} ${PAID_JOIN} WHERE ${openWhere}) t
        WHERE open_amt > 0 GROUP BY customer_id
     ), ids AS (
       SELECT customer_id FROM inv UNION SELECT customer_id FROM pay UNION SELECT customer_id FROM opn
     )
     SELECT ids.customer_id,
            coalesce(nullif(${customerNameSql('c')}, ''), CASE WHEN ids.customer_id IS NULL THEN 'Unassigned' ELSE 'Unnamed' END) AS name,
            coalesce(inv.n, 0) AS invoice_count, ${money('inv.amt')} AS invoiced, ${money('pay.amt')} AS collected,
            ${money('opn.open_all')} AS open_all, ${money('opn.cohort')} AS cohort,
            count(*) OVER()::int AS total
       FROM ids
       LEFT JOIN customers c ON c.id = ids.customer_id
       LEFT JOIN inv ON inv.customer_id IS NOT DISTINCT FROM ids.customer_id
       LEFT JOIN pay ON pay.customer_id IS NOT DISTINCT FROM ids.customer_id
       LEFT JOIN opn ON opn.customer_id IS NOT DISTINCT FROM ids.customer_id
      WHERE true ${search}
      ORDER BY ${REVENUE_SORT_SQL[list.sort]} ${list.dir === 'desc' ? 'DESC' : 'ASC'}, ids.customer_id
      LIMIT ${limit} OFFSET ${offset}`,
    p.values,
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => ({
      customerId: r.customer_id, name: r.name, currency, invoiceCount: r.invoice_count,
      invoiced: r.invoiced, collected: r.collected, outstanding: r.open_all, outstandingIssuedInRange: r.cohort,
    })),
  };
}
