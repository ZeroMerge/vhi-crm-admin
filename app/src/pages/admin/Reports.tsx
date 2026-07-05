import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Package, MessageSquare, TrendingUp, Download } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/utils/formatCurrency';
import { reportService } from '@/services/report.service';
import { customerService } from '@/services/customer.service';
import { invoiceService } from '@/services/invoice.service';
import type { ReportData } from '@/services/report.service';
import type { Customer, Invoice } from '@/types';

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

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [revenueLoading, setRevenueLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchRevenueData = async () => {
      setRevenueLoading(true);
      try {
        const custRes = await customerService.list({ page: 1, pageSize: 100 });
        const invRes = await invoiceService.list({ page: 1, pageSize: 100 });
        if (active) {
          setCustomers(custRes.data);
          setInvoices(invRes.data);
        }
      } catch (err) {
        console.error('Failed to fetch revenue data:', err);
      } finally {
        if (active) setRevenueLoading(false);
      }
    };
    fetchRevenueData();
    return () => { active = false; };
  }, []);

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
      {}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--color-surface)', padding: 6, borderRadius: 'var(--border-radius-pill)', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              style={{
                padding: '8px 20px',
                borderRadius: 'var(--border-radius-pill)',
                border: 'none',
                background: activeTab === tab.value ? 'var(--color-primary-light)' : 'transparent',
                color: activeTab === tab.value ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: activeTab === tab.value ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="btn btn-outline" onClick={handleExport} disabled={loading} style={{ background: 'var(--color-surface)', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          <Download size={16} />
          Export Report (CSV)
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.04)', padding: 24, minHeight: 140 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div className="skeleton" style={{ width: 100, height: 16, borderRadius: 4 }} />
                  <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
                </div>
                <div className="skeleton" style={{ width: 140, height: 32, borderRadius: 6 }} />
              </div>
            ))}
          </div>
          <div className="skeleton" style={{ height: 300, background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.04)' }} />
          <div className="skeleton" style={{ height: 200, background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.04)' }} />
        </div>
      ) : (
        <>
          {/* Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 32 }}>
            {metrics.map((metric) => (
              <div key={metric.label} style={{ 
                background: 'var(--color-surface)', 
                borderRadius: '12px', 
                border: '1px solid rgba(0,0,0,0.04)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
              }}>
                <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: 12, fontWeight: 500 }}>
                      {metric.label}
                    </div>
                    <div style={{ fontSize: '32px', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                      {metric.isCurrency ? formatCurrency(metric.value, 'NGN') : metric.value.toLocaleString()}
                    </div>
                  </div>
                  <div style={{ 
                    width: 32, height: 32, borderRadius: '8px', 
                    background: 'var(--color-surface)', 
                    border: '1px solid rgba(0,0,0,0.04)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--color-text-secondary)'
                  }}>
                    <metric.icon size={16} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {}
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

          {}
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

          {/* Revenue Breakdown */}
          <div className="card" style={{ marginTop: 24 }}>
            <h3 className="card-title" style={{ marginBottom: 20 }}>Revenue Breakdown</h3>
            
            {revenueLoading ? (
               <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading revenue data...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
                {/* Customers Table */}
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-card)', overflow: 'hidden' }}>
                  <div style={{ padding: '16px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                    <h4 style={{ fontWeight: 600, margin: 0 }}>Revenue by Customer</h4>
                  </div>
                  <div className="vhi-table-container" style={{ border: 'none', maxHeight: 400, overflowY: 'auto', borderRadius: 0 }}>
                    <table className="vhi-table">
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th style={{ textAlign: 'right' }}>Total Invoiced</th>
                          <th style={{ textAlign: 'right' }}>Total Paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customers.map(c => (
                          <tr key={c.id}>
                            <td>{c.firstname} {c.lastname}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(c.totalInvoiced || 0, 'NGN')}</td>
                            <td style={{ textAlign: 'right', color: 'var(--color-primary)', fontWeight: 500 }}>{formatCurrency(c.totalPaid || 0, 'NGN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Invoices Table */}
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-card)', overflow: 'hidden' }}>
                  <div style={{ padding: '16px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                    <h4 style={{ fontWeight: 600, margin: 0 }}>Revenue by Invoice</h4>
                  </div>
                  <div className="vhi-table-container" style={{ border: 'none', maxHeight: 400, overflowY: 'auto', borderRadius: 0 }}>
                    <table className="vhi-table">
                      <thead>
                        <tr>
                          <th>Invoice No</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th style={{ textAlign: 'right' }}>Paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map(inv => {
                          const paidAmount = inv.payments?.filter(p => p.paymentStatus === 'success').reduce((sum, p) => sum + p.amount, 0) || 0;
                          return (
                            <tr key={inv.id}>
                              <td>{inv.invoiceNumber}</td>
                              <td><Badge status={inv.status} type="invoice" size="sm" /></td>
                              <td style={{ textAlign: 'right' }}>{formatCurrency(inv.amount, inv.currency)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--color-primary)', fontWeight: 500 }}>{formatCurrency(paidAmount, inv.currency)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </PageWrapper>
  );
}
