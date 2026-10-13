import pool from '../../config/db';
import { buildBuckets } from './dateRange';
import { ListParams, ReportFilters } from './filters';
import { Params, SHIPMENT_COUNTERS, bucketSql, customerNameSql, escapeLike, shipmentEventsCte } from './sql';

export interface ShipmentCounts {
  /** Created in range (drafts excluded). */
  created: number;
  /** Of the shipments created in range: currently pending. */
  pending: number;
  /** Of the shipments created in range: currently processing, in transit or in clearance. */
  inProgress: number;
  /** Delivered, and became delivered in range (status_changed_at). */
  completed: number;
  /** Cancelled, and became cancelled in range (status_changed_at). */
  cancelled: number;
}

export interface ShipmentPoint extends ShipmentCounts {
  bucket: string;
  label: string;
  /** The bucket clipped to the report range; what a drill-down link carries. */
  from: string;
  to: string;
  partial: boolean;
}

const ZERO: ShipmentCounts = { created: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 };

const counts = (r: any): ShipmentCounts => ({
  created: r.created, pending: r.pending, inProgress: r.in_progress, completed: r.completed, cancelled: r.cancelled,
});

export function sumCounts(rows: ShipmentCounts[]): ShipmentCounts {
  return rows.reduce(
    (t, r) => ({
      created: t.created + r.created, pending: t.pending + r.pending, inProgress: t.inProgress + r.inProgress,
      completed: t.completed + r.completed, cancelled: t.cancelled + r.cancelled,
    }),
    { ...ZERO },
  );
}

/** One row per bucket in the range (empty buckets included) plus the totals. One query. */
export async function shipmentSeries(f: ReportFilters): Promise<{ points: ShipmentPoint[]; totals: ShipmentCounts }> {
  const p = new Params();
  const { sql: cte, tz } = shipmentEventsCte(p, f);
  const { rows } = await pool.query(
    `WITH ${cte}
     SELECT ${bucketSql('at', f.granularity, tz)} AS bucket, ${SHIPMENT_COUNTERS}
       FROM ev GROUP BY 1`,
    p.values,
  );
  const byBucket = new Map<string, ShipmentCounts>(rows.map((r) => [r.bucket as string, counts(r)]));
  const points = buildBuckets(f.from, f.to, f.granularity).map((b) => ({
    bucket: b.start, label: b.label, from: b.from, to: b.to, partial: b.partial, ...(byBucket.get(b.start) ?? ZERO),
  }));
  return { points, totals: sumCounts(points) };
}

export const SHIPMENT_CUSTOMER_SORTS = ['name', 'created', 'pending', 'inProgress', 'completed', 'cancelled'] as const;
const SORT_SQL: Record<string, string> = {
  name: 'name', created: 'created', pending: 'pending', inProgress: 'in_progress', completed: 'completed', cancelled: 'cancelled',
};

export interface ShipmentCustomerRow extends ShipmentCounts {
  /** null = shipments with no customer. */
  customerId: string | null;
  name: string;
}

/** Shipment counters per customer, sortable and paginated, in one query. */
export async function shipmentsByCustomer(
  f: ReportFilters,
  list: ListParams,
): Promise<{ rows: ShipmentCustomerRow[]; total: number }> {
  const p = new Params();
  const { sql: cte } = shipmentEventsCte(p, f);
  const search = list.q ? `AND (${customerNameSql('c')} ILIKE ${p.add(`%${escapeLike(list.q)}%`)} OR c.email ILIKE ${p.add(`%${escapeLike(list.q)}%`)})` : '';
  const limit = p.add(list.pageSize);
  const offset = p.add((list.page - 1) * list.pageSize);
  const { rows } = await pool.query(
    `WITH ${cte},
     agg AS (SELECT customer_id, ${SHIPMENT_COUNTERS} FROM ev GROUP BY customer_id)
     SELECT agg.*, coalesce(nullif(${customerNameSql('c')}, ''), CASE WHEN agg.customer_id IS NULL THEN 'Unassigned' ELSE 'Unnamed' END) AS name,
            count(*) OVER()::int AS total
       FROM agg LEFT JOIN customers c ON c.id = agg.customer_id
      WHERE true ${search}
      ORDER BY ${SORT_SQL[list.sort]} ${list.dir === 'desc' ? 'DESC' : 'ASC'}, agg.customer_id
      LIMIT ${limit} OFFSET ${offset}`,
    p.values,
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => ({ customerId: r.customer_id, name: r.name, ...counts(r) })),
  };
}
