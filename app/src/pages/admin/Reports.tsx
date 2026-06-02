import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Package, MessageSquare, TrendingUp, Download } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { formatCurrency } from '@/utils/formatCurrency';
import { reportService } from '@/services/report.service';
import type { ReportData } from '@/services/report.service';

const tabs = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
];

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('period') || 'daily';

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchReport = async () => {
      setLoading(true);
      try {
        const response = await reportService.getReport(activeTab);
        if (active) {
          setData(response);
        }
      } catch (err) {
        console.error('Failed to load report:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchReport();
    return () => {
      active = false;
    };
  }, [activeTab]);

  const handleTabChange = (tab: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('period', tab);
    setSearchParams(newParams);
  };

  const handleExport = async () => {
    try {
      const blob = await reportService.exportReport(activeTab);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${activeTab}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export report:', err);
      alert('Error exporting report. Please try again.');
    }
  };

  const metrics = [
    { label: 'New Users', value: data?.newUsers || 0, icon: Users, color: '#7B2D8B' },
    { label: 'Pending Shipments', value: data?.pendingShipments || 0, icon: Package, color: '#C62828' },
    { label: 'Total Enquiries', value: data?.totalEnquiries || 0, icon: MessageSquare, color: '#1565C0' },
    { label: 'Revenue', value: data?.revenue || 0, icon: TrendingUp, color: '#2E7D32', isCurrency: true },
  ];

  const totalCustomers = data?.customerBreakdown?.reduce((sum: number, item: any) => sum + parseInt(String(item.count)), 0) || 0;
  const leadCount = data?.customerBreakdown?.find((item: any) => item.status === 'lead')?.count || 0;
  const prospectCount = data?.customerBreakdown?.find((item: any) => item.status === 'prospect')?.count || 0;
  const loyalCount = data?.customerBreakdown?.find((item: any) => item.status === 'loyal')?.count || 0;
  const returningCount = data?.customerBreakdown?.find((item: any) => item.status === 'returning')?.count || 0;

  return (
    <PageWrapper title="Reports">
      {/* Tabs + Export */}
      <div className="two-col-layout" style={{ marginBottom: 24 }}>
        <div>
          <div className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                className={`tab ${activeTab === tab.value ? 'active' : ''}`}
                onClick={() => handleTabChange(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="col-right">
          <button className="btn btn-outline" onClick={handleExport} disabled={loading}>
            <Download size={16} />
            Export Report (CSV)
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            {[1, 2, 3, 4].map((i) => <div key={i} className="card animate-pulse" style={{ height: 110, background: 'var(--color-surface)' }} />)}
          </div>
          <div className="card animate-pulse" style={{ height: 300, background: 'var(--color-surface)' }} />
          <div className="card animate-pulse" style={{ height: 200, background: 'var(--color-surface)' }} />
        </div>
      ) : (
        <>
          {/* Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 32 }}>
            {metrics.map((metric) => {
              return (
                <div key={metric.label} className="card" style={{ minHeight: 110 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                    <div className="metric-icon-wrapper" style={{ width: 44, height: 44, borderRadius: 'var(--radius-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: 'var(--color-surface)' }}>
                      <metric.icon size={22} color="var(--color-text-secondary)" />
                    </div>
                    <span className="metric-label" style={{ fontSize: 'var(--font-size-sm)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)' }}>{metric.label}</span>
                  </div>
                  <div className="metric-value" style={{ fontSize: 'var(--font-size-4xl)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {metric.isCurrency ? formatCurrency(metric.value, 'NGN') : metric.value.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Shipment Breakdown */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 className="card-title" style={{ marginBottom: 20 }}>Shipment Breakdown</h3>
            <div className="vhi-table-container" style={{ border: 'none' }}>
              {data?.shipmentBreakdown && data.shipmentBreakdown.length > 0 && data.shipmentBreakdown.some((row: any) => Number(row.count) > 0 || Number(row.value) > 0) ? (
                <table className="vhi-table">
                  <thead>
                    <tr>
                      <th>Shipping Mode</th>
                      <th style={{ textAlign: 'right' }}>Count</th>
                      <th style={{ textAlign: 'right' }}>Total Value</th>
                      <th>Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.shipmentBreakdown.map((row: any) => {
                      const totalCount = data.shipmentBreakdown.reduce((s: number, r: any) => s + parseInt(String(r.count)), 0);
                      const countNum = parseInt(String(row.count));
                      const valueNum = parseFloat(String(row.value));
                      const pct = totalCount > 0 ? Math.round((countNum / totalCount) * 100) : 0;
                      return (
                        <tr key={row.mode}>
                          <td style={{ fontWeight: 500, textTransform: 'capitalize' }}>{row.mode ? row.mode.replace(/_/g, ' ') : 'Unknown'}</td>
                          <td style={{ textAlign: 'right' }}>{countNum}</td>
                          <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(valueNum, 'NGN')}</td>
                          <td style={{ width: 200 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 8, background: 'var(--color-border)', borderRadius: 'var(--border-radius-pill)', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 'var(--border-radius-pill)' }} />
                              </div>
                              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', width: 36 }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  No data available for this period.
                </div>
              )}
            </div>
          </div>

          {/* Customer Overview */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 20 }}>Customer Overview</h3>
            {totalCustomers === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No customer data available for this period.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                {[
                  { label: 'Total Customers', value: totalCustomers },
                  { label: 'New Leads', value: leadCount },
                  { label: 'Prospects', value: prospectCount },
                  { label: 'Loyal Customers', value: loyalCount },
                  { label: 'Returning Customers', value: returningCount },
                ].map((item) => (
                  <div key={item.label} className="card" style={{ padding: '20px 24px', minHeight: '120px' }}>
                    <span className="metric-label" style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, display: 'block', color: 'var(--color-text-secondary)' }}>
                      {item.label}
                    </span>
                    <div className="stat-value" style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      {item.value.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </PageWrapper>
  );
}
