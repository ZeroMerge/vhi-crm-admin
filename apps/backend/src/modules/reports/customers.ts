import pool from '../../config/db';
import { ListParams, ReportFilters } from './filters';
import {
  INVOICE_FROM, OPEN_AMOUNT, PAID_JOIN, PAYMENT_DATE, PAYMENT_FROM, Params, SHIPMENT_COUNTERS,
  customerConditions, customerNameSql, escapeLike, invoiceConditions, money, paymentConditions, rangeBounds, shipmentEventsCte,
} from './sql';
import type { ShipmentCounts } from './shipments';

export const CUSTOMER_BASE_SORTS = ['name', 'industry', 'created', 'pending', 'inProgress', 'completed', 'cancelled'] as const;
export const CUSTOMER_MONEY_SORTS = ['invoiceCount', 'invoiced', 'collected', 'outstanding'] as const;

const SORT_SQL: Record<string, string> = {
  name: 'name', industry: 'c.industry::text', created: 'coalesce(shp.created, 0)', pending: 'coalesce(shp.pending, 0)',
  inProgress: 'coalesce(shp.in_progress, 0)', completed: 'coalesce(shp.completed, 0)', cancelled: 'coalesce(shp.cancelled, 0)',
  invoiceCount: 'coalesce(inv.n, 0)', invoiced: 'coalesce(inv.amt, 0)', collected: 'coalesce(pay.amt, 0)', outstanding: 'coalesce(opn.open_all, 0)',
};

export interface CustomerReportRow {
  customerId: string;
  name: string;
  industry: string | null;
  /** Present only when the caller's role has the customers module. */
  email?: string | null;
  phone?: string | null;
  shipments: ShipmentCounts;
  /** Present only when the caller's role has the invoices module; all for `currency`. */
  money?: { currency: string; invoiceCount: number; invoiced: string; collected: string; outstanding: string };
}

export interface CustomersReportOptions {
  contacts: boolean;
  revenue: boolean;
  /** The single currency of the money columns (ignored without `revenue`). */
  currency: string;
}

/**
 * Every customer matching the filters (activity or not), with shipment counters and, when permitted, money for one currency.
 * Counters follow docs/REPORTS.md: created / pending / in progress are the created-in-range snapshot; completed / cancelled are
 * dated by when the shipment got there. Money: invoiced and collected in range, outstanding = all open invoices as of now.
 */
export async function customersReport(
  f: ReportFilters,
  list: ListParams,
  options: CustomersReportOptions,
): Promise<{ rows: CustomerReportRow[]; total: number }> {
  const p = new Params();
  const { sql: shipCte } = shipmentEventsCte(p, f);
  // Only when money is built: a placeholder that no SQL text uses cannot be typed by Postgres.
  const { lo, hi } = options.revenue ? rangeBounds(p, f) : { lo: '', hi: '' };

  const where: string[] = [];
  if (f.customerId) where.push(`c.id = ${p.add(f.customerId)}::uuid`);
  where.push(...customerConditions(p, f));
  if (list.q) {
    const like = p.add(`%${escapeLike(list.q)}%`);
    // Email and phone are searchable only for roles that may see them (otherwise search would reveal them).
    where.push(options.contacts
      ? `(${customerNameSql('c')} ILIKE ${like} OR c.email ILIKE ${like} OR c.phone ILIKE ${like})`
      : `${customerNameSql('c')} ILIKE ${like}`);
  }

  const moneyCtes = options.revenue
    ? `,
     inv AS (
       SELECT i.customer_id, count(*)::int AS n, sum(i.amount) AS amt
         FROM ${INVOICE_FROM}
        WHERE ${invoiceConditions(p, f, options.currency).join(' AND ')} AND i.issued_at >= ${lo} AND i.issued_at < ${hi}
        GROUP BY i.customer_id
     ), pay AS (
       SELECT py.customer_id, sum(py.amount) AS amt
         FROM ${PAYMENT_FROM}
        WHERE ${paymentConditions(p, f, options.currency).join(' AND ')} AND ${PAYMENT_DATE} >= ${lo} AND ${PAYMENT_DATE} < ${hi}
        GROUP BY py.customer_id
     ), opn AS (
       SELECT customer_id, sum(open_amt) AS open_all
         FROM (SELECT i.customer_id, ${OPEN_AMOUNT} AS open_amt
                 FROM ${INVOICE_FROM} ${PAID_JOIN}
                WHERE ${invoiceConditions(p, f, options.currency).join(' AND ')}) t
        WHERE open_amt > 0 GROUP BY customer_id
     )`
    : '';
  const moneyJoins = options.revenue
    ? `LEFT JOIN inv ON inv.customer_id = c.id LEFT JOIN pay ON pay.customer_id = c.id LEFT JOIN opn ON opn.customer_id = c.id`
    : '';
  const moneySelect = options.revenue
    ? `, coalesce(inv.n, 0) AS invoice_count, ${money('inv.amt')} AS invoiced, ${money('pay.amt')} AS collected, ${money('opn.open_all')} AS outstanding`
    : '';
  const sortKey = SORT_SQL[list.sort];
  const limit = p.add(list.pageSize);
  const offset = p.add((list.page - 1) * list.pageSize);

  const { rows } = await pool.query(
    `WITH ${shipCte},
     shp AS (SELECT customer_id, ${SHIPMENT_COUNTERS} FROM ev WHERE customer_id IS NOT NULL GROUP BY customer_id)${moneyCtes}
     SELECT c.id, c.email, c.phone, c.industry::text AS industry,
            coalesce(nullif(${customerNameSql('c')}, ''), 'Unnamed') AS name,
            coalesce(shp.created, 0) AS created, coalesce(shp.pending, 0) AS pending, coalesce(shp.in_progress, 0) AS in_progress,
            coalesce(shp.completed, 0) AS completed, coalesce(shp.cancelled, 0) AS cancelled${moneySelect},
            count(*) OVER()::int AS total
       FROM customers c LEFT JOIN shp ON shp.customer_id = c.id ${moneyJoins}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${sortKey} ${list.dir === 'desc' ? 'DESC' : 'ASC'}, c.id
      LIMIT ${limit} OFFSET ${offset}`,
    p.values,
  );

  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => {
      const row: CustomerReportRow = {
        customerId: r.id,
        name: r.name,
        industry: r.industry,
        shipments: { created: r.created, pending: r.pending, inProgress: r.in_progress, completed: r.completed, cancelled: r.cancelled },
      };
      if (options.contacts) {
        row.email = r.email;
        row.phone = r.phone;
      }
      if (options.revenue) {
        row.money = { currency: options.currency, invoiceCount: r.invoice_count, invoiced: r.invoiced, collected: r.collected, outstanding: r.outstanding };
      }
      return row;
    }),
  };
}
