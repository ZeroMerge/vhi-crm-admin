import pool from '../../../config/db';
import { formatDate, formatDateTime } from '../../../utils/appTime';
import { customersReport } from '../customers';
import type { ReportFilters } from '../filters';
import { currenciesInUse, dataQuality, outstanding, resolveCurrency, revenueByCustomer, revenueSeries } from '../revenue';
import { shipmentSeries, shipmentsByCustomer } from '../shipments';

// A format-neutral description of the report file. build() runs the SAME query functions as the UI endpoints, so a file can never
// disagree with the screen it was exported from; the PDF, DOCX and XLSX writers only lay this out.

export const EXPORT_SECTIONS = ['summary', 'shipments', 'revenue', 'customers'] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export const EXPORT_FORMATS = ['pdf', 'docx', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Rows per table, per format. Past the cap the file says so and suggests Excel or narrower filters. */
export const ROW_CAPS: Record<ExportFormat, number> = { xlsx: 50_000, pdf: 1_000, docx: 1_000 };

/** Money keeps its exact decimal text and the row's own currency. */
export interface Money { money: string; currency: string }
/** A calendar date (YYYY-MM-DD, local date in the report's time zone). */
export interface DateOnly { date: string }
export type Cell = string | number | null | Money | DateOnly;

export interface Column {
  header: string;
  /** Relative width; the writers scale the weights to the page. */
  weight: number;
  align?: 'left' | 'right';
}

export interface TableData {
  id: string;
  title: string;
  columns: Column[];
  rows: Cell[][];
  /** Rows that exist; rows.length < total means the table is truncated. */
  total: number;
  note?: string;
}

export interface SectionData { id: ExportSection; title: string; tables: TableData[] }

export interface ReportDoc {
  title: string;
  company: string;
  /** "Label: value" lines naming every filter and the resolved range. */
  filterLines: string[];
  rangeText: string;
  generatedAt: string;
  generatedBy: string;
  /** File-level notices (truncation, currency, definitions). */
  notices: string[];
  sections: SectionData[];
  format: ExportFormat;
  rowCap: number;
}

export interface BuildContext {
  filters: ReportFilters;
  sections: ExportSection[];
  format: ExportFormat;
  caps: { revenue: boolean; contacts: boolean };
  company: string;
  generatedBy: string;
  now?: Date;
  /** Tests only: replaces the per-format row cap. The route never sets it. */
  rowCap?: number;
}

const BATCH = 1000;
const money = (amount: string, currency: string): Money => ({ money: amount, currency });
const date = (d: string): DateOnly => ({ date: d });

export const humanize = (value: string | null | undefined, empty = 'Not set'): string =>
  value ? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : empty;

const RANGE_LABELS: Record<string, string> = {
  this_week: 'This week', this_month: 'This month', this_year: 'This year', last_30_days: 'Last 30 days', custom: 'Custom',
};

function prettyDate(ymd: string): string {
  return formatDate(new Date(`${ymd}T12:00:00Z`), 'UTC');
}

export const rangeText = (f: ReportFilters) =>
  f.from === f.to ? `${prettyDate(f.from)} (${f.timezone})` : `${prettyDate(f.from)} to ${prettyDate(f.to)} (${f.timezone})`;

async function customerName(id: string): Promise<string> {
  const { rows } = await pool.query(`SELECT btrim(concat_ws(' ', firstname, lastname)) AS name FROM customers WHERE id = $1`, [id]);
  return rows[0]?.name || 'Unknown customer';
}

/** Every filter, with where it does and does not apply. */
async function filterLines(ctx: BuildContext, currency: string | null): Promise<string[]> {
  const f = ctx.filters;
  const wantsRevenue = ctx.sections.some((s) => s === 'revenue' || s === 'summary' || s === 'customers') && ctx.caps.revenue;
  const lines = [
    `Range: ${RANGE_LABELS[f.range]}, ${rangeText(f)}`,
    `Granularity: ${humanize(f.granularity)}`,
    `Customer: ${f.customerId ? await customerName(f.customerId) : 'All'}`,
    `Industry: ${f.industry ? humanize(f.industry === 'none' ? null : f.industry) : 'All'}`,
    `Shipment status group: ${f.statusGroup ? humanize(f.statusGroup) : 'All'}${f.statusGroup ? ' (applies to shipments; not applied to revenue)' : ''}`,
    `Shipping mode: ${f.mode ? humanize(f.mode) : 'All'}`,
  ];
  if (ctx.caps.revenue && wantsRevenue) {
    lines.push(`Currency: ${f.currency ?? 'All'}${currency && !f.currency ? ` (customer tables show ${currency})` : ''} (revenue only; not applied to shipments)`);
  }
  return lines;
}

async function collectAll<T>(fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>, cap: number): Promise<{ rows: T[]; total: number }> {
  const out: T[] = [];
  let total = 0;
  // Always reads the first page, even with nothing left to collect: that is where `total` comes from.
  for (let page = 1; ; page++) {
    const r = await fetchPage(page);
    total = r.total;
    if (out.length < cap) out.push(...r.rows.slice(0, cap - out.length));
    if (r.rows.length < BATCH || page * BATCH >= total || out.length >= cap) break;
  }
  return { rows: out, total };
}

export async function buildReport(ctx: BuildContext): Promise<ReportDoc> {
  const f = ctx.filters;
  const cap = ctx.rowCap ?? ROW_CAPS[ctx.format];
  const now = ctx.now ?? new Date();
  const wants = (s: ExportSection) => ctx.sections.includes(s);
  const revenueAllowed = ctx.caps.revenue;
  const notices: string[] = [];
  const sections: SectionData[] = [];

  const needsShipments = wants('summary') || wants('shipments');
  const shipments = needsShipments ? await shipmentSeries(f) : null;
  const needsRevenue = revenueAllowed && (wants('summary') || wants('revenue'));
  const rev = needsRevenue ? await revenueSeries(f) : null;
  const needsCurrency = revenueAllowed && (wants('revenue') || wants('customers'));
  const { currency, currencies } = needsCurrency ? await resolveCurrency(f) : { currency: null as string | null, currencies: [] as string[] };

  if (wants('summary')) {
    const rows: Cell[][] = [];
    if (shipments) {
      const t = shipments.totals;
      const basis = 'Created in range (drafts excluded)';
      rows.push(['Shipments', 'Created', t.created, basis]);
      rows.push(['Shipments', 'Pending', t.pending, 'Of the shipments created in range: currently pending']);
      rows.push(['Shipments', 'In progress', t.inProgress, 'Of the shipments created in range: currently processing, in transit or in clearance']);
      rows.push(['Shipments', 'Completed', t.completed, 'Delivered, and became delivered in range']);
      rows.push(['Shipments', 'Cancelled', t.cancelled, 'Cancelled, and became cancelled in range']);
    }
    if (rev) {
      const open = await outstanding(f);
      const quality = await dataQuality();
      const codes = [...new Set([...Object.keys(rev.totals), ...Object.keys(open)])].sort();
      for (const c of codes) {
        const r = rev.totals[c];
        const o = open[c];
        rows.push([`Revenue ${c}`, 'Invoiced', money(r?.invoiced ?? '0.00', c), 'Non-draft invoices issued in range']);
        rows.push([`Revenue ${c}`, 'Collected', money(r?.collected ?? '0.00', c), 'Successful payments in range (paid date, else recorded date)']);
        rows.push([`Revenue ${c}`, 'Outstanding (all open invoices, as of today)', money(o?.openAll ?? '0.00', c), 'Every non-draft invoice, whenever issued; not limited to the range']);
        rows.push([`Revenue ${c}`, 'Outstanding (invoices issued in range)', money(o?.issuedInRange ?? '0.00', c), 'Balance today of the invoices issued in range']);
      }
      if (quality.paymentsDatedByFallback || quality.paidStatusWithOutstanding) {
        const parts: string[] = [];
        if (quality.paymentsDatedByFallback) parts.push(`${quality.paymentsDatedByFallback} successful payment(s) have no paid date and are dated by when they were recorded`);
        if (quality.paidStatusWithOutstanding) parts.push(`${quality.paidStatusWithOutstanding} invoice(s) are marked paid but still show a balance`);
        notices.push(`Data quality: ${parts.join('; ')}.`);
      }
    }
    sections.push({
      id: 'summary', title: 'Summary',
      tables: [{
        id: 'summary', title: 'Summary', total: rows.length, rows,
        columns: [{ header: 'Group', weight: 2 }, { header: 'Metric', weight: 4 }, { header: 'Value', weight: 2, align: 'right' }, { header: 'Basis', weight: 6 }],
      }],
    });
  }

  if (wants('shipments') && shipments) {
    const periodRows: Cell[][] = shipments.points.map((p) => [p.label, date(p.from), date(p.to), p.created, p.pending, p.inProgress, p.completed, p.cancelled]);
    const byCustomer = await collectAll(
      (page) => shipmentsByCustomer(f, { page, pageSize: BATCH, sort: 'created', dir: 'desc' }),
      cap,
    );
    const numeric: Column[] = ['Created', 'Pending', 'In progress', 'Completed', 'Cancelled'].map((header) => ({ header, weight: 1.5, align: 'right' as const }));
    sections.push({
      id: 'shipments', title: 'Shipments',
      tables: [
        {
          id: 'shipments_by_period', title: 'Shipments by period', total: periodRows.length, rows: periodRows,
          columns: [{ header: 'Period', weight: 2 }, { header: 'From', weight: 2 }, { header: 'To', weight: 2 }, ...numeric],
          note: 'Pending and In progress describe the shipments created in that period, by current status. Completed and Cancelled are counted in the period they happened.',
        },
        {
          id: 'shipments_by_customer', title: 'Shipments by customer', total: byCustomer.total,
          rows: byCustomer.rows.map((r) => [r.name, r.created, r.pending, r.inProgress, r.completed, r.cancelled]),
          columns: [{ header: 'Customer', weight: 5 }, ...numeric],
        },
      ],
    });
  }

  if (wants('revenue') && revenueAllowed && rev) {
    const periodRows: Cell[][] = [];
    for (const p of rev.points) {
      for (const c of Object.keys(p.byCurrency).sort()) {
        const v = p.byCurrency[c];
        periodRows.push([p.label, date(p.from), date(p.to), c, money(v.invoiced, c), v.invoiceCount, money(v.collected, c), v.paymentCount]);
      }
    }
    const codes = f.currency ? [f.currency] : currencies;
    const customerRows: Cell[][] = [];
    let customerTotal = 0;
    for (const c of codes) {
      const all = await collectAll(
        (page) => revenueByCustomer(f, { page, pageSize: BATCH, sort: 'collected', dir: 'desc' }, c),
        Math.max(cap - customerRows.length, 0),
      );
      customerTotal += all.total;
      for (const r of all.rows) {
        customerRows.push([r.name, c, r.invoiceCount, money(r.invoiced, c), money(r.collected, c), money(r.outstanding, c), money(r.outstandingIssuedInRange, c)]);
      }
    }
    const right = (header: string, weight = 2): Column => ({ header, weight, align: 'right' });
    sections.push({
      id: 'revenue', title: 'Revenue',
      tables: [
        {
          id: 'revenue_by_period', title: 'Revenue by period', total: periodRows.length, rows: periodRows,
          columns: [{ header: 'Period', weight: 2 }, { header: 'From', weight: 2 }, { header: 'To', weight: 2 }, { header: 'Currency', weight: 1.5 }, right('Invoiced', 3), right('Invoices', 1.5), right('Collected', 3), right('Payments', 1.5)],
          note: 'One row per period and currency; periods without invoices or payments are left out. Currencies are never added together.',
        },
        {
          id: 'revenue_by_customer', title: 'Revenue by customer', total: customerTotal, rows: customerRows,
          columns: [{ header: 'Customer', weight: 5 }, { header: 'Currency', weight: 1.5 }, right('Invoices', 1.5), right('Invoiced', 3), right('Collected', 3), right('Outstanding (all open, today)', 3.5), right('Outstanding (issued in range)', 3.5)],
        },
      ],
    });
  }

  if (wants('customers')) {
    const columnsForMoney = revenueAllowed && currency;
    const all = await collectAll(
      (page) => customersReport(f, { page, pageSize: BATCH, sort: 'name', dir: 'asc' }, { contacts: ctx.caps.contacts, revenue: Boolean(columnsForMoney), currency: currency ?? '' }),
      cap,
    );
    const columns: Column[] = [{ header: 'Customer', weight: 4 }];
    if (ctx.caps.contacts) columns.push({ header: 'Email', weight: 5 }, { header: 'Phone', weight: 3 });
    columns.push({ header: 'Industry', weight: 3 });
    // Wide enough that "Completed" and "Cancelled" do not break mid-word in the 13-column PDF layout.
    for (const header of ['Created', 'Pending', 'In progress', 'Completed', 'Cancelled']) columns.push({ header, weight: 2.2, align: 'right' });
    if (columnsForMoney) {
      columns.push({ header: 'Invoices', weight: 2.2, align: 'right' }, { header: `Invoiced (${currency})`, weight: 3, align: 'right' },
        { header: `Collected (${currency})`, weight: 3, align: 'right' }, { header: `Outstanding (${currency})`, weight: 3, align: 'right' });
    }
    const rows: Cell[][] = all.rows.map((r) => {
      const row: Cell[] = [r.name];
      if (ctx.caps.contacts) row.push(r.email ?? null, r.phone ?? null);
      row.push(humanize(r.industry));
      row.push(r.shipments.created, r.shipments.pending, r.shipments.inProgress, r.shipments.completed, r.shipments.cancelled);
      if (columnsForMoney && r.money) {
        row.push(r.money.invoiceCount, money(r.money.invoiced, r.money.currency), money(r.money.collected, r.money.currency), money(r.money.outstanding, r.money.currency));
      }
      return row;
    });
    if (columnsForMoney && !f.currency && currencies.length > 1) {
      notices.push(`Customer tables show ${currency}, the most-used currency (other currencies in use: ${currencies.filter((c) => c !== currency).join(', ')}). Pick a currency filter to export another; the revenue section lists every currency.`);
    }
    sections.push({
      id: 'customers', title: 'Customers',
      tables: [{
        id: 'customers', title: 'Customers', total: all.total, rows, columns,
        note: columnsForMoney
          ? 'Outstanding is every open invoice of the customer as of today. Shipment columns follow the rules in the Summary.'
          : 'Shipment columns follow the rules in the Summary.',
      }],
    });
  }

  const truncated = sections.flatMap((s) => s.tables).filter((t) => t.rows.length < t.total);
  for (const t of truncated) {
    notices.unshift(`${t.title}: showing the first ${t.rows.length.toLocaleString('en-US')} of ${t.total.toLocaleString('en-US')} rows (the ${ctx.format.toUpperCase()} limit). Use the Excel export or narrower filters for the rest.`);
  }

  return {
    title: 'Reports',
    company: ctx.company,
    filterLines: await filterLines(ctx, currency),
    rangeText: rangeText(f),
    generatedAt: formatDateTime(now, f.timezone),
    generatedBy: ctx.generatedBy,
    notices,
    sections,
    format: ctx.format,
    rowCap: cap,
  };
}

/** Row counts per table, for the audit log. */
export function rowCounts(doc: ReportDoc): Record<string, { shown: number; total: number }> {
  const out: Record<string, { shown: number; total: number }> = {};
  for (const s of doc.sections) for (const t of s.tables) out[t.id] = { shown: t.rows.length, total: t.total };
  return out;
}

// ---- shared text formatting for the PDF and DOCX writers ----

const SYMBOLS: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€' };

/** "₦1,234.50" / "CAD 1,234.50" from exact decimal text, with no float arithmetic. */
export function formatMoney(m: Money): string {
  const negative = m.money.startsWith('-');
  const [int, frac = '00'] = m.money.replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = SYMBOLS[m.currency];
  return `${negative ? '-' : ''}${symbol ?? `${m.currency} `}${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return cell.toLocaleString('en-US');
  // Control characters (tab, CR, LF...) have no glyph in the PDF font and would print as boxes; as text they are only whitespace.
  // Everything else, including = + - @ at the start, is shown exactly as stored (the XLSX writer does not use this function).
  if (typeof cell === 'string') return cell.replace(/[\x00-\x1f\x7f]+/g, ' ');
  if ('money' in cell) return formatMoney(cell);
  return prettyDate(cell.date);
}
