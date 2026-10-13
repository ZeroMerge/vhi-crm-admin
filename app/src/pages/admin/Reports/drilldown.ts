// Pure link builders for the report drill-downs (no imports, so the backend test suite can load this file as it does
// rolePermissions.ts: test/reports.drilldown.links.test.ts). Every link carries the SAME filters as the figure it opens, as
// concrete local dates (presets are already resolved by the server). Mapping: docs/REPORTS.md "Drill-down".

export interface DrillFilters {
  from: string;
  to: string;
  customerId?: string | null;
  industry?: string | null;
  mode?: string | null;
  currency?: string | null;
  statusGroup?: string | null;
}

export type ShipmentMetric = 'created' | 'pending' | 'inProgress' | 'completed' | 'cancelled';
export type RevenueMetric = 'invoiced' | 'collected' | 'outstandingOpen' | 'outstandingIssued';

function qs(entries: Array<[string, string | null | undefined | false]>): string {
  const p = new URLSearchParams();
  for (const [k, v] of entries) if (v) p.set(k, v);
  return p.toString();
}

/** An optional narrowing to one bucket (the bar or table row that was clicked). */
export interface DateWindow { from: string; to: string }

export function shipmentsLink(metric: ShipmentMetric, f: DrillFilters, window?: DateWindow, customerId?: string | null): string {
  const w = window ?? f;
  const base: Array<[string, string | null | undefined | false]> = [
    ['createdFrom', w.from], ['createdTo', w.to],
    ['customerId', customerId ?? f.customerId], ['industry', f.industry], ['mode', f.mode],
  ];
  switch (metric) {
    case 'created': return `/admin/shipments?${qs([...base, ['excludeDraft', 'true']])}`;
    case 'pending': return `/admin/shipments?${qs([...base, ['excludeDraft', 'true'], ['status', 'pending']])}`;
    case 'inProgress': return `/admin/shipments?${qs([...base, ['excludeDraft', 'true'], ['statusGroup', 'in_progress']])}`;
    // Events are dated by when they happened, not by creation.
    case 'completed': return `/admin/shipments?${qs([...base, ['status', 'delivered'], ['dateField', 'status_changed']])}`;
    case 'cancelled': return `/admin/shipments?${qs([...base, ['status', 'cancelled'], ['dateField', 'status_changed']])}`;
  }
}

export function invoicesLink(metric: RevenueMetric, f: DrillFilters, currency: string | null | undefined, window?: DateWindow, customerId?: string | null): string {
  const w = window ?? f;
  const common: Array<[string, string | null | undefined | false]> = [
    ['currency', currency], ['customerId', customerId ?? f.customerId], ['industry', f.industry], ['mode', f.mode],
  ];
  switch (metric) {
    case 'invoiced': return `/admin/invoices?${qs([['issuedFrom', w.from], ['issuedTo', w.to], ['excludeDraft', 'true'], ...common])}`;
    case 'collected': return `/admin/invoices?${qs([['paidFrom', w.from], ['paidTo', w.to], ...common])}`;
    // The main Outstanding card is not date-bound.
    case 'outstandingOpen': return `/admin/invoices?${qs([['excludeDraft', 'true'], ['hasOutstanding', 'true'], ...common])}`;
    case 'outstandingIssued': return `/admin/invoices?${qs([['issuedFrom', w.from], ['issuedTo', w.to], ['excludeDraft', 'true'], ['hasOutstanding', 'true'], ...common])}`;
  }
}

export const customerLink = (id: string) => `/admin/customers/${id}`;
