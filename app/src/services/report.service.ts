import api from './api';

// Report endpoints (docs/REPORTS.md). Money is exact decimal text ("1234.50"): format it, do not do arithmetic on it.

export type Granularity = 'day' | 'week' | 'month' | 'year';
export type RangePreset = 'this_week' | 'this_month' | 'this_year' | 'last_30_days' | 'custom';
export type StatusGroup = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type ExportFormat = 'pdf' | 'docx' | 'xlsx';
export type ExportSection = 'summary' | 'shipments' | 'revenue' | 'customers';

/** The filters shared by every section; the keys are the query parameter names of both the API and the page URL. */
export interface ReportFilterParams {
  range?: RangePreset;
  from?: string;
  to?: string;
  granularity?: Granularity;
  customerId?: string;
  industry?: string;
  statusGroup?: StatusGroup;
  mode?: string;
  currency?: string;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  q?: string;
}

export interface ResolvedFilters {
  range: RangePreset;
  from: string;
  to: string;
  granularity: Granularity;
  timezone: string;
  customerId: string | null;
  industry: string | null;
  statusGroup: StatusGroup | null;
  mode: string | null;
  currency: string | null;
}

export interface Capabilities { revenue: boolean; contacts: boolean }

export interface ReportMeta {
  timezone: string;
  today: string;
  presets: Record<string, { from: string; to: string }>;
  granularities: Granularity[];
  statusGroups: StatusGroup[];
  industries: string[];
  modes: string[];
  currencies: string[];
  capabilities: Capabilities;
  limits: { maxRangeDays: number; maxBuckets: number; maxPageSize: number };
}

export interface ShipmentCounts { created: number; pending: number; inProgress: number; completed: number; cancelled: number }
export interface Bucket { bucket: string; label: string; from: string; to: string; partial: boolean }
export type ShipmentPoint = Bucket & ShipmentCounts;

export interface CurrencyFigures { invoiced: string; invoiceCount: number; collected: string; paymentCount: number }
export interface RevenuePoint extends Bucket { byCurrency: Record<string, CurrencyFigures> }

export interface SummaryCurrency extends CurrencyFigures {
  outstandingOpen: string;
  outstandingOpenCount: number;
  outstandingIssuedInRange: string;
  outstandingIssuedInRangeCount: number;
}

export interface Summary {
  filters: ResolvedFilters;
  capabilities: Capabilities;
  shipments: ShipmentCounts;
  revenue?: {
    currencies: string[];
    byCurrency: Record<string, SummaryCurrency>;
    dataQuality: { paymentsDatedByFallback: number; paidStatusWithOutstanding: number };
  };
}

export interface ShipmentCustomerRow extends ShipmentCounts { customerId: string | null; name: string }
export interface RevenueCustomerRow {
  customerId: string | null;
  name: string;
  currency: string;
  invoiceCount: number;
  invoiced: string;
  collected: string;
  outstanding: string;
  outstandingIssuedInRange: string;
}
export interface CustomerReportRow {
  customerId: string;
  name: string;
  industry: string | null;
  email?: string | null;
  phone?: string | null;
  shipments: ShipmentCounts;
  money?: { currency: string; invoiceCount: number; invoiced: string; collected: string; outstanding: string };
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  meta: { filters: ResolvedFilters; currency?: string; currencies?: string[] };
}

type Query = object;

const clean = (query: Query) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query) as Array<[string, string | number | undefined | null]>) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
};

async function get<T>(path: string, query: Query, signal?: AbortSignal): Promise<any> {
  const res = await api.get(`/api/admin/reports${path}`, { params: clean(query), signal });
  return res.data as { data: T; pagination?: any; meta?: any };
}

async function page<T>(path: string, filters: ReportFilterParams, list: ListParams, signal?: AbortSignal): Promise<Page<T>> {
  const body = await get<T[]>(path, { ...filters, ...list }, signal);
  const p = body.pagination ?? {};
  return {
    rows: body.data, total: p.total ?? 0, page: p.page ?? 1, pageSize: p.pageSize ?? 25, totalPages: p.totalPages ?? 1, meta: body.meta,
  };
}

/** The message the API sent, also when the body arrived as a Blob (export errors). */
export async function reportErrorMessage(err: any): Promise<string> {
  const data = err?.response?.data;
  try {
    const body = data instanceof Blob ? JSON.parse(await data.text()) : data;
    if (body?.errors?.[0]) return `${body.errors[0].field}: ${body.errors[0].message}`;
    if (body?.message) return String(body.message);
  } catch { /* fall through */ }
  if (err?.response?.status === 429) return 'Too many exports. Wait a minute and try again.';
  return err?.message || 'Something went wrong';
}

export const reportService = {
  meta: async (signal?: AbortSignal): Promise<ReportMeta> => (await get<ReportMeta>('/meta', {}, signal)).data,
  customerOptions: async (q: string, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> =>
    (await get<Array<{ id: string; name: string }>>('/options/customers', { q, limit: 20 }, signal)).data,
  summary: async (filters: ReportFilterParams, signal?: AbortSignal): Promise<Summary> => (await get<Summary>('/summary', filters, signal)).data,
  shipmentSeries: async (filters: ReportFilterParams, signal?: AbortSignal): Promise<{ filters: ResolvedFilters; points: ShipmentPoint[]; totals: ShipmentCounts }> =>
    (await get('/shipments/series', filters, signal)).data,
  shipmentsByCustomer: (filters: ReportFilterParams, list: ListParams, signal?: AbortSignal) =>
    page<ShipmentCustomerRow>('/shipments/by-customer', filters, list, signal),
  revenueSeries: async (filters: ReportFilterParams, signal?: AbortSignal): Promise<{ filters: ResolvedFilters; points: RevenuePoint[]; totals: Record<string, CurrencyFigures> }> =>
    (await get('/revenue/series', filters, signal)).data,
  revenueByCustomer: (filters: ReportFilterParams, list: ListParams, signal?: AbortSignal) =>
    page<RevenueCustomerRow>('/revenue/by-customer', filters, list, signal),
  customers: (filters: ReportFilterParams, list: ListParams, signal?: AbortSignal) => page<CustomerReportRow>('/customers', filters, list, signal),

  /** Downloads through the authenticated axios instance (a plain link could not send the Bearer token). */
  exportReport: async (format: ExportFormat, sections: ExportSection[], filters: ReportFilterParams, today?: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await api.get('/api/admin/reports/export', {
      params: clean({ ...filters, format, sections: sections.join(',') }),
      responseType: 'blob',
    });
    const disposition = String(res.headers['content-disposition'] ?? '');
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `vhi-report${today ? `-${today}` : ''}.${format}`;
    return { blob: res.data as Blob, filename };
  },
};
