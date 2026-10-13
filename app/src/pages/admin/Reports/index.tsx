import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { reportService } from '@/services/report.service';
import type {
  CustomerReportRow, ResolvedFilters, RevenueCustomerRow, ShipmentCounts, ShipmentCustomerRow, SummaryCurrency,
} from '@/services/report.service';
import '@/styles/reports.css';
import { DataTable } from './DataTable';
import type { Column } from './DataTable';
import { ExportMenu } from './ExportMenu';
import { FilterBar } from './FilterBar';
import { SeriesChart } from './SeriesChart';
import type { ChartPoint } from './SeriesChart';
import { customerLink, invoicesLink, shipmentsLink } from './drilldown';
import type { DrillFilters, ShipmentMetric } from './drilldown';
import { compactNumber, formatInt, formatMoneyText, humanize, plural } from './format';
import { useReportData, useReportFilters } from './useReportFilters';

const drill = (f: ResolvedFilters): DrillFilters => ({
  from: f.from, to: f.to, customerId: f.customerId, industry: f.industry, mode: f.mode, currency: f.currency, statusGroup: f.statusGroup,
});

function Metric({ label, value, note, href }: { label: string; value: string; note?: string; href: string }) {
  return (
    <Link to={href} className="rpt-metric" aria-label={`${label}: ${value}. Open the list.`}>
      <span className="rpt-metric-label">{label}</span>
      <span className="rpt-metric-value">{value}</span>
      {note && <span className="rpt-metric-note">{note}</span>}
    </Link>
  );
}

function Loading({ height = 120 }: { height?: number }) {
  return <div className="rpt-skel" style={{ height }} aria-hidden="true" />;
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rpt-error" role="alert">
      <span>{message}</span>
      <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>Try again</button>
    </div>
  );
}

/** Loading, error and content for one section, so a failing section never blanks the page. */
function Block<T>({ state, height, children }: { state: { data: T | null; loading: boolean; error: string | null; retry: () => void }; height?: number; children: (data: T) => ReactNode }) {
  if (state.error) return <Failure message={state.error} onRetry={state.retry} />;
  if (!state.data) return <Loading height={height} />;
  return <div style={{ opacity: state.loading ? 0.6 : 1 }} aria-busy={state.loading}>{children(state.data)}</div>;
}

const SHIPMENT_CARDS: Array<{ metric: ShipmentMetric; label: string; field: keyof ShipmentCounts; note: string }> = [
  { metric: 'created', label: 'Created', field: 'created', note: 'created in this range' },
  { metric: 'pending', label: 'Pending', field: 'pending', note: 'of those created: pending now' },
  { metric: 'inProgress', label: 'In progress', field: 'inProgress', note: 'of those created: in progress now' },
  { metric: 'completed', label: 'Completed', field: 'completed', note: 'delivered in this range' },
  { metric: 'cancelled', label: 'Cancelled', field: 'cancelled', note: 'cancelled in this range' },
];

export default function Reports() {
  const { filters, filtersKey, setFilters, clearFilters, table, setTable } = useReportFilters();
  const meta = useReportData((s) => reportService.meta(s), []);
  const ready = Boolean(meta.data);
  const caps = meta.data?.capabilities ?? { revenue: false, contacts: false };
  const tableKey = (id: 's' | 'r' | 'c') => JSON.stringify(table(id));

  const summary = useReportData((s) => reportService.summary(filters, s), [filtersKey], ready);
  const shipSeries = useReportData((s) => reportService.shipmentSeries(filters, s), [filtersKey], ready);
  const shipCustomers = useReportData((s) => reportService.shipmentsByCustomer(filters, table('s'), s), [filtersKey, tableKey('s')], ready);
  const revSeries = useReportData((s) => reportService.revenueSeries(filters, s), [filtersKey], ready && caps.revenue);
  const revCustomers = useReportData((s) => reportService.revenueByCustomer(filters, table('r'), s), [filtersKey, tableKey('r')], ready && caps.revenue);
  const customers = useReportData((s) => reportService.customers(filters, table('c'), s), [filtersKey, tableKey('c')], ready);

  const resolved = summary.data?.filters ?? shipSeries.data?.filters;
  const primaryCurrency = filters.currency ?? meta.data?.currencies[0] ?? 'NGN';

  if (meta.error) {
    return <PageWrapper title="Reports"><Failure message={meta.error} onRetry={meta.retry} /></PageWrapper>;
  }

  const shipPoints = (f: ResolvedFilters, points: NonNullable<typeof shipSeries.data>['points']): ChartPoint[] =>
    points.map((p) => ({
      key: p.bucket, label: p.label, partial: p.partial,
      a: p.created, b: p.completed, aText: formatInt(p.created), bText: formatInt(p.completed),
      hrefA: shipmentsLink('created', drill(f), p), hrefB: shipmentsLink('completed', drill(f), p),
    }));

  const revPoints = (f: ResolvedFilters, points: NonNullable<typeof revSeries.data>['points']): ChartPoint[] =>
    points.map((p) => {
      const v = p.byCurrency[primaryCurrency];
      return {
        key: p.bucket, label: p.label, partial: p.partial,
        a: Number(v?.invoiced ?? 0), b: Number(v?.collected ?? 0),
        aText: formatMoneyText(v?.invoiced ?? '0.00', primaryCurrency), bText: formatMoneyText(v?.collected ?? '0.00', primaryCurrency),
        hrefA: invoicesLink('invoiced', drill(f), primaryCurrency, p), hrefB: invoicesLink('collected', drill(f), primaryCurrency, p),
      };
    });

  const countCell = (f: ResolvedFilters, metric: ShipmentMetric, customerId: string | null, value: number) =>
    customerId ? <Link to={shipmentsLink(metric, drill(f), undefined, customerId)}>{formatInt(value)}</Link> : formatInt(value);

  const nameCell = (id: string | null, name: string) => (id ? <Link to={customerLink(id)}>{name || 'Unnamed'}</Link> : name);

  const shipCols = (f: ResolvedFilters): Column<ShipmentCustomerRow>[] => [
    { key: 'name', header: 'Customer', sort: 'name', render: (r) => nameCell(r.customerId, r.name) },
    ...SHIPMENT_CARDS.map((c) => ({
      key: c.field, header: c.label, numeric: true, sort: c.field,
      render: (r: ShipmentCustomerRow) => countCell(f, c.metric, r.customerId, r[c.field]),
    })),
  ];

  const revCols = (f: ResolvedFilters, currency: string): Column<RevenueCustomerRow>[] => [
    { key: 'name', header: 'Customer', sort: 'name', render: (r) => nameCell(r.customerId, r.name) },
    { key: 'invoiceCount', header: 'Invoices', numeric: true, sort: 'invoiceCount', render: (r) => formatInt(r.invoiceCount) },
    { key: 'invoiced', header: `Invoiced (${currency})`, numeric: true, sort: 'invoiced', render: (r) => r.customerId ? <Link to={invoicesLink('invoiced', drill(f), currency, undefined, r.customerId)}>{formatMoneyText(r.invoiced, currency)}</Link> : formatMoneyText(r.invoiced, currency) },
    { key: 'collected', header: `Collected (${currency})`, numeric: true, sort: 'collected', render: (r) => r.customerId ? <Link to={invoicesLink('collected', drill(f), currency, undefined, r.customerId)}>{formatMoneyText(r.collected, currency)}</Link> : formatMoneyText(r.collected, currency) },
    { key: 'outstanding', header: 'Outstanding, all open (today)', numeric: true, sort: 'outstanding', render: (r) => r.customerId ? <Link to={invoicesLink('outstandingOpen', drill(f), currency, undefined, r.customerId)}>{formatMoneyText(r.outstanding, currency)}</Link> : formatMoneyText(r.outstanding, currency) },
    { key: 'issued', header: 'Outstanding, issued in range', numeric: true, render: (r) => r.customerId ? <Link to={invoicesLink('outstandingIssued', drill(f), currency, undefined, r.customerId)}>{formatMoneyText(r.outstandingIssuedInRange, currency)}</Link> : formatMoneyText(r.outstandingIssuedInRange, currency) },
  ];

  const customerCols = (f: ResolvedFilters): Column<CustomerReportRow>[] => {
    const cols: Column<CustomerReportRow>[] = [{ key: 'name', header: 'Customer', sort: 'name', render: (r) => nameCell(r.customerId, r.name) }];
    if (caps.contacts) {
      cols.push({ key: 'email', header: 'Email', render: (r) => r.email ?? '' }, { key: 'phone', header: 'Phone', render: (r) => r.phone ?? '' });
    }
    cols.push({ key: 'industry', header: 'Industry', sort: 'industry', render: (r) => humanize(r.industry) });
    for (const c of SHIPMENT_CARDS) {
      cols.push({ key: c.field, header: c.label, numeric: true, sort: c.field, render: (r) => countCell(f, c.metric, r.customerId, r.shipments[c.field]) });
    }
    if (caps.revenue) {
      cols.push(
        { key: 'invoiceCount', header: 'Invoices', numeric: true, sort: 'invoiceCount', render: (r) => (r.money ? formatInt(r.money.invoiceCount) : '') },
        { key: 'invoiced', header: 'Invoiced', numeric: true, sort: 'invoiced', render: (r) => r.money ? <Link to={invoicesLink('invoiced', drill(f), r.money.currency, undefined, r.customerId)}>{formatMoneyText(r.money.invoiced, r.money.currency)}</Link> : '' },
        { key: 'collected', header: 'Collected', numeric: true, sort: 'collected', render: (r) => r.money ? <Link to={invoicesLink('collected', drill(f), r.money.currency, undefined, r.customerId)}>{formatMoneyText(r.money.collected, r.money.currency)}</Link> : '' },
        { key: 'outstanding', header: 'Outstanding', numeric: true, sort: 'outstanding', render: (r) => r.money ? <Link to={invoicesLink('outstandingOpen', drill(f), r.money.currency, undefined, r.customerId)}>{formatMoneyText(r.money.outstanding, r.money.currency)}</Link> : '' },
      );
    }
    return cols;
  };

  return (
    <PageWrapper title="Reports">
      <div className="rpt">
        <div className="rpt-head">
          <p className="rpt-sub" style={{ maxWidth: 640 }}>
            Every figure, bar and row opens the list behind it with the same filters. Dates are in the business time zone{meta.data ? ` (${meta.data.timezone})` : ''}.
          </p>
          <ExportMenu filters={filters} capabilities={caps} today={meta.data?.today} disabled={!ready} />
        </div>

        {meta.data ? (
          <FilterBar meta={meta.data} filters={filters} resolved={resolved} onChange={setFilters} onReset={clearFilters} />
        ) : (
          <Loading height={110} />
        )}

        {/* ---- Shipments ---- */}
        <section className="rpt-section" aria-labelledby="rpt-shipments">
          <h2 id="rpt-shipments">Shipments</h2>
          <Block state={summary} height={90}>
            {(s) => (
              <>
                <div className="rpt-cards">
                  {SHIPMENT_CARDS.map((c) => (
                    <Metric key={c.metric} label={c.label} value={formatInt(s.shipments[c.field])} note={c.note} href={shipmentsLink(c.metric, drill(s.filters))} />
                  ))}
                </div>
                <p className="rpt-note">
                  Pending and In progress count the shipments created in this range by their current status. Completed and Cancelled are counted when they happened. Drafts are never counted.
                </p>
              </>
            )}
          </Block>
          <Block state={shipSeries} height={300}>
            {(d) => (
              <SeriesChart
                title="Shipments created and completed per period"
                seriesA="Created" seriesB="Completed"
                points={shipPoints(d.filters, d.points)}
                axisFormat={compactNumber}
                summary={`${formatInt(d.totals.created)} created and ${formatInt(d.totals.completed)} completed across ${d.points.length} periods.`}
              />
            )}
          </Block>
          <DataTable
            caption="Shipments by customer" columns={resolved ? shipCols(resolved) : []} rows={shipCustomers.data?.rows ?? null}
            total={shipCustomers.data?.total ?? 0} list={table('s')} loading={shipCustomers.loading} error={shipCustomers.error} onRetry={shipCustomers.retry}
            onSort={(sort, dir) => setTable('s', { sort, dir })} onPage={(page) => setTable('s', { page })}
            rowKey={(r) => r.customerId ?? 'unassigned'} rowHref={(r) => (r.customerId && resolved ? shipmentsLink('created', drill(resolved), undefined, r.customerId) : null)}
          />
        </section>

        {/* ---- Revenue (invoices module only) ---- */}
        {caps.revenue && (
          <section className="rpt-section" aria-labelledby="rpt-revenue">
            <h2 id="rpt-revenue">Revenue</h2>
            <Block state={summary} height={90}>
              {(s) => {
                const rev = s.revenue;
                if (!rev || rev.currencies.length === 0) return <div className="rpt-state">No invoices or payments for these filters.</div>;
                const many = rev.currencies.length > 1;
                return (
                  <>
                    {rev.currencies.map((c) => {
                      const v: SummaryCurrency = rev.byCurrency[c];
                      const f = drill(s.filters);
                      return (
                        <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {many && <h3 className="rpt-currency-title">{c}</h3>}
                          <div className="rpt-cards">
                            <Metric label="Revenue (collected)" value={formatMoneyText(v.collected, c)} note={`${plural(v.paymentCount, 'payment')} in range`} href={invoicesLink('collected', f, c)} />
                            <Metric label="Invoiced" value={formatMoneyText(v.invoiced, c)} note={`${plural(v.invoiceCount, 'invoice')} issued in range`} href={invoicesLink('invoiced', f, c)} />
                            <Metric label="Outstanding (all open invoices, as of today)" value={formatMoneyText(v.outstandingOpen, c)} note={`${plural(v.outstandingOpenCount, 'invoice')}; not limited by the date range`} href={invoicesLink('outstandingOpen', f, c)} />
                            <Metric label="Outstanding (invoices issued in range)" value={formatMoneyText(v.outstandingIssuedInRange, c)} note={`${plural(v.outstandingIssuedInRangeCount, 'invoice')}; balance today`} href={invoicesLink('outstandingIssued', f, c)} />
                          </div>
                        </div>
                      );
                    })}
                    <p className="rpt-note">
                      Currencies are never added together. Outstanding is worked out from recorded payments, not from invoice status.
                      {rev.dataQuality.paymentsDatedByFallback > 0 && ` ${plural(rev.dataQuality.paymentsDatedByFallback, 'payment')} with no paid date count on the day they were recorded.`}
                      {rev.dataQuality.paidStatusWithOutstanding > 0 && ` ${plural(rev.dataQuality.paidStatusWithOutstanding, 'invoice')} marked paid still show a balance.`}
                    </p>
                  </>
                );
              }}
            </Block>
            <Block state={revSeries} height={300}>
              {(d) => (
                <>
                  <SeriesChart
                    title={`Invoiced and collected per period (${primaryCurrency})`}
                    seriesA="Invoiced" seriesB="Collected"
                    points={revPoints(d.filters, d.points)}
                    axisFormat={compactNumber}
                    summary={`Invoiced ${formatMoneyText(d.totals[primaryCurrency]?.invoiced, primaryCurrency)}, collected ${formatMoneyText(d.totals[primaryCurrency]?.collected, primaryCurrency)}.`}
                  />
                  {Object.keys(d.totals).filter((c) => c !== primaryCurrency).length > 0 && (
                    <p className="rpt-note">The chart and the table below show {primaryCurrency}. Other currencies in this range: {Object.keys(d.totals).filter((c) => c !== primaryCurrency).join(', ')}. Pick one in the Currency filter.</p>
                  )}
                </>
              )}
            </Block>
            <DataTable
              caption={`Revenue by customer (${revCustomers.data?.meta.currency ?? primaryCurrency})`}
              columns={resolved ? revCols(resolved, revCustomers.data?.meta.currency ?? primaryCurrency) : []} rows={revCustomers.data?.rows ?? null}
              total={revCustomers.data?.total ?? 0} list={table('r')} loading={revCustomers.loading} error={revCustomers.error} onRetry={revCustomers.retry}
              onSort={(sort, dir) => setTable('r', { sort, dir })} onPage={(page) => setTable('r', { page })}
              rowKey={(r) => r.customerId ?? 'unassigned'}
              rowHref={(r) => (r.customerId ? customerLink(r.customerId) : null)}
              emptyText="No invoices, payments or open balances for these filters."
            />
          </section>
        )}

        {/* ---- Customers report ---- */}
        <section className="rpt-section" aria-labelledby="rpt-customers">
          <h2 id="rpt-customers">Customers</h2>
          <p className="rpt-sub">
            Every customer matching the filters{caps.revenue && customers.data?.meta.currency ? `; money columns are in ${customers.data.meta.currency}` : ''}.
            {caps.revenue ? ' Outstanding is every open invoice of the customer as of today.' : ''}
          </p>
          <DataTable
            caption="Customers" columns={resolved ? customerCols(resolved) : []} rows={customers.data?.rows ?? null}
            total={customers.data?.total ?? 0} list={table('c')} loading={customers.loading} error={customers.error} onRetry={customers.retry}
            onSort={(sort, dir) => setTable('c', { sort, dir })} onPage={(page) => setTable('c', { page })}
            rowKey={(r) => r.customerId} rowHref={(r) => customerLink(r.customerId)}
            search={{ value: table('c').q ?? '', onSearch: (q) => setTable('c', { q }), label: caps.contacts ? 'Search name, email or phone' : 'Search by name' }}
          />
        </section>
      </div>
    </PageWrapper>
  );
}
