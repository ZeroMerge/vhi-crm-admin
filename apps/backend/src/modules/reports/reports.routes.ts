import { Router, Request, Response } from 'express';
import { z } from 'zod';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { moduleGuard, requireActiveAdmin, roleHasModule } from '../../middleware/permissions';
import { appTimezone } from '../../utils/appTime';
import { GRANULARITIES, MAX_BUCKETS, MAX_RANGE_DAYS, RANGE_PRESETS, resolvePreset } from './dateRange';
import {
  FilterIssue, INDUSTRIES, ListParams, ReportFilters, SHIPPING_MODES, STATUS_GROUPS,
  parseFilters, parseListParams, todayIn, withoutListKeys,
} from './filters';
import { SHIPMENT_CUSTOMER_SORTS, shipmentSeries, shipmentsByCustomer } from './shipments';
import {
  REVENUE_CUSTOMER_SORTS, currenciesInUse, dataQuality, outstanding, resolveCurrency, revenueByCustomer, revenueSeries,
} from './revenue';
import { CUSTOMER_BASE_SORTS, CUSTOMER_MONEY_SORTS, customersReport } from './customers';
import { customerNameSql, escapeLike } from './sql';

const router = Router();

router.use(adminMiddleware, requireActiveAdmin, moduleGuard('reports'));

// What the caller's ACTIVE role may see. Revenue is enforced always (never the PERMISSION_ENFORCEMENT=log rollout mode):
// these endpoints are new, so there is nothing to roll out gently.
export function reportCapabilities(role: string | null | undefined) {
  return { revenue: roleHasModule(role, 'invoices'), contacts: roleHasModule(role, 'customers') };
}

function badRequest(res: Response, issues: FilterIssue[]) {
  return res.status(400).json({ success: false, message: 'Invalid report parameters', errors: issues });
}

function forbiddenRevenue(res: Response) {
  return res.status(403).json({ success: false, message: 'Revenue reports require access to the invoices module' });
}

/** The echo of the resolved filters that every response carries (the UI and the exports show exactly this). */
export function filtersView(f: ReportFilters) {
  return {
    range: f.range, from: f.from, to: f.to, granularity: f.granularity, timezone: f.timezone,
    customerId: f.customerId ?? null, industry: f.industry ?? null, statusGroup: f.statusGroup ?? null,
    mode: f.mode ?? null, currency: f.currency ?? null,
  };
}

function readFilters(req: Request, res: Response, stripKeys: string[] = []): ReportFilters | null {
  const query = withoutListKeys(req.query as Record<string, unknown>);
  for (const k of stripKeys) delete query[k];
  const parsed = parseFilters(query);
  if (!parsed.ok) {
    badRequest(res, parsed.issues);
    return null;
  }
  return parsed.filters;
}

function readList(req: Request, res: Response, sorts: readonly string[], defaultSort: string): ListParams | null {
  const parsed = parseListParams(req.query as Record<string, unknown>, sorts, defaultSort);
  if (!parsed.ok) {
    badRequest(res, parsed.issues);
    return null;
  }
  return parsed.list;
}

const pagination = (list: ListParams, total: number) => ({
  total, page: list.page, pageSize: list.pageSize, totalPages: Math.ceil(total / list.pageSize),
});

// ---- options for the filter bar ----

router.get('/meta', async (req, res, next) => {
  try {
    const caps = reportCapabilities(req.admin!.activeRole);
    const timezone = appTimezone();
    const today = todayIn(timezone);
    const presets: Record<string, { from: string; to: string }> = {};
    for (const preset of RANGE_PRESETS) if (preset !== 'custom') presets[preset] = resolvePreset(preset, today);
    res.json({
      success: true,
      data: {
        timezone, today, presets,
        granularities: GRANULARITIES, statusGroups: STATUS_GROUPS, industries: INDUSTRIES, modes: SHIPPING_MODES,
        currencies: caps.revenue ? await currenciesInUse() : [],
        capabilities: caps,
        limits: { maxRangeDays: MAX_RANGE_DAYS, maxBuckets: MAX_BUCKETS, maxPageSize: 100 },
      },
    });
  } catch (err) { next(err); }
});

const optionsQuery = z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(20).default(20) });

// Picker data only: id and name, never contact details.
router.get('/options/customers', async (req, res, next) => {
  try {
    const parsed = optionsQuery.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const { q, limit } = parsed.data;
    const params: unknown[] = [];
    let where = '';
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      where = `WHERE ${customerNameSql('c')} ILIKE $1`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT c.id, ${customerNameSql('c')} AS name FROM customers c ${where} ORDER BY name, c.id LIMIT $${params.length}`,
      params,
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ---- summary cards ----

router.get('/summary', async (req, res, next) => {
  try {
    const f = readFilters(req, res);
    if (!f) return;
    const caps = reportCapabilities(req.admin!.activeRole);
    const shipments = await shipmentSeries(f);
    const data: Record<string, unknown> = { filters: filtersView(f), capabilities: caps, shipments: shipments.totals };
    if (caps.revenue) {
      const [rev, open, quality, order] = await Promise.all([revenueSeries(f), outstanding(f), dataQuality(), currenciesInUse()]);
      const codes = new Set([...Object.keys(rev.totals), ...Object.keys(open)]);
      const currencies = [...codes].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
      data.revenue = {
        currencies,
        byCurrency: Object.fromEntries(
          currencies.map((c) => [c, {
            invoiced: rev.totals[c]?.invoiced ?? '0.00', invoiceCount: rev.totals[c]?.invoiceCount ?? 0,
            collected: rev.totals[c]?.collected ?? '0.00', paymentCount: rev.totals[c]?.paymentCount ?? 0,
            outstandingOpen: open[c]?.openAll ?? '0.00', outstandingOpenCount: open[c]?.openAllCount ?? 0,
            outstandingIssuedInRange: open[c]?.issuedInRange ?? '0.00', outstandingIssuedInRangeCount: open[c]?.issuedInRangeCount ?? 0,
          }]),
        ),
        dataQuality: quality,
      };
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ---- shipments ----

router.get('/shipments/series', async (req, res, next) => {
  try {
    const f = readFilters(req, res);
    if (!f) return;
    const { points, totals } = await shipmentSeries(f);
    res.json({ success: true, data: { filters: filtersView(f), points, totals } });
  } catch (err) { next(err); }
});

router.get('/shipments/by-customer', async (req, res, next) => {
  try {
    const list = readList(req, res, SHIPMENT_CUSTOMER_SORTS, 'created');
    const f = list && readFilters(req, res);
    if (!list || !f) return;
    const { rows, total } = await shipmentsByCustomer(f, list);
    res.json({ success: true, data: rows, pagination: pagination(list, total), meta: { filters: filtersView(f) } });
  } catch (err) { next(err); }
});

// ---- revenue (invoices module only) ----

router.use('/revenue', (req, res, next) => {
  if (!reportCapabilities(req.admin!.activeRole).revenue) return forbiddenRevenue(res);
  next();
});

router.get('/revenue/series', async (req, res, next) => {
  try {
    const f = readFilters(req, res);
    if (!f) return;
    const [{ points, totals }, open] = await Promise.all([revenueSeries(f), outstanding(f)]);
    res.json({ success: true, data: { filters: filtersView(f), points, totals, outstanding: open } });
  } catch (err) { next(err); }
});

router.get('/revenue/by-customer', async (req, res, next) => {
  try {
    const list = readList(req, res, REVENUE_CUSTOMER_SORTS, 'collected');
    const f = list && readFilters(req, res);
    if (!list || !f) return;
    const { currency, currencies } = await resolveCurrency(f);
    const { rows, total } = await revenueByCustomer(f, list, currency);
    res.json({ success: true, data: rows, pagination: pagination(list, total), meta: { filters: filtersView(f), currency, currencies } });
  } catch (err) { next(err); }
});

// ---- customers report ----

router.get('/customers', async (req, res, next) => {
  try {
    const caps = reportCapabilities(req.admin!.activeRole);
    const sorts = caps.revenue ? [...CUSTOMER_BASE_SORTS, ...CUSTOMER_MONEY_SORTS] : CUSTOMER_BASE_SORTS;
    const list = readList(req, res, sorts, 'name');
    const f = list && readFilters(req, res);
    if (!list || !f) return;
    const { currency, currencies } = caps.revenue ? await resolveCurrency(f) : { currency: '', currencies: [] as string[] };
    const { rows, total } = await customersReport(f, list, { contacts: caps.contacts, revenue: caps.revenue, currency });
    res.json({
      success: true, data: rows, pagination: pagination(list, total),
      meta: { filters: filtersView(f), capabilities: caps, ...(caps.revenue ? { currency, currencies } : {}) },
    });
  } catch (err) { next(err); }
});

// ---- legacy (kept for one release; Overview moves to /summary, then these are removed: RISKS R-69) ----

const getPeriodFilter = (period: string): string => {
  switch (period) {
    case 'daily': return "created_at >= CURRENT_DATE";
    case 'weekly': return "created_at >= CURRENT_DATE - INTERVAL '7 days'";
    case 'monthly': return "created_at >= CURRENT_DATE - INTERVAL '30 days'";
    case 'yearly': return "created_at >= CURRENT_DATE - INTERVAL '365 days'";
    case 'all': return "1=1";
    default: return "1=1";
  }
};


router.get('/:period', adminMiddleware, async (req, res, next) => {
  try {
    const period = req.params.period;
    const filter = getPeriodFilter(period);

    const newUsers = await pool.query(`SELECT COUNT(*) FROM customers WHERE ${filter}`);
    const pendingShipments = await pool.query(`SELECT COUNT(*) FROM shipments WHERE status = 'pending' AND ${filter}`);
    const totalEnquiries = await pool.query(`SELECT COUNT(*) FROM shipments WHERE ${filter}`);
    const revenue = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE payment_status = 'success' AND ${filter}`);

    const breakdown = await pool.query(
      `SELECT shipping_mode as mode, COUNT(*) as count, COALESCE(SUM(invoice_value), 0) as value 
       FROM shipments WHERE ${filter} GROUP BY shipping_mode`
    );

    const customerBreakdown = await pool.query(
      `SELECT status, COUNT(*) as count FROM customers WHERE ${filter} GROUP BY status`
    );

    res.json({
      success: true,
      data: {
        newUsers: parseInt(newUsers.rows[0].count),
        pendingShipments: parseInt(pendingShipments.rows[0].count),
        totalEnquiries: parseInt(totalEnquiries.rows[0].count),
        revenue: parseFloat(revenue.rows[0].total),
        shipmentBreakdown: breakdown.rows,
        customerBreakdown: customerBreakdown.rows,
      },
    });
  } catch (err) { next(err); }
});


router.get('/export', adminMiddleware, async (req, res, next) => {
  try {
    const period = (req.query.period as string) || 'monthly';
    const filter = getPeriodFilter(period);

    const newUsers = await pool.query(`SELECT COUNT(*) FROM customers WHERE ${filter}`);
    const pendingShipments = await pool.query(`SELECT COUNT(*) FROM shipments WHERE status = 'pending' AND ${filter}`);
    const totalEnquiries = await pool.query(`SELECT COUNT(*) FROM shipments WHERE ${filter}`);
    const revenue = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE payment_status = 'success' AND ${filter}`);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=report-${period}.csv`);
    
    const today = new Date().toISOString().split('T')[0];
    const csvRows = [
      'Date,Metric,Value',
      `${today},New Users,${parseInt(newUsers.rows[0].count)}`,
      `${today},Pending Shipments,${parseInt(pendingShipments.rows[0].count)}`,
      `${today},Total Shipments,${parseInt(totalEnquiries.rows[0].count)}`,
      `${today},Revenue,${parseFloat(revenue.rows[0].total)}`
    ];

    res.send(csvRows.join('\n') + '\n');
  } catch (err) { next(err); }
});

export default router;
