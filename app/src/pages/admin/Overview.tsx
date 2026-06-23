import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, DollarSign, Activity, AlertTriangle, MoreVertical, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { ExportModal } from '@/components/shared/ExportModal';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import { invoiceService } from '@/services/invoice.service';
import { customerService } from '@/services/customer.service';
import { shipmentService } from '@/services/shipment.service';
import { reportService } from '@/services/report.service';
import { useAuthStore } from '@/store/authStore';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { Shipment } from '@/types';

const tabs: { label: string; value: string; count?: number }[] = [
  { label: 'All', value: 'all' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'In transit', value: 'in_transit' },
  { label: 'Pending', value: 'pending' },
  { label: 'Processing', value: 'processing' },
];



export default function Overview() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const [activeTab, setActiveTab] = useState('all');
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const [customerCount, setCustomerCount] = useState<number>(0);
  const [revenue, setRevenue] = useState<number>(0);
  const [inTransitCount, setInTransitCount] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [overdueCount, setOverdueCount] = useState<number>(0);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [savedScrollLeft, setSavedScrollLeft] = useState(0);

  const handleScroll = () => {
    if (tableContainerRef.current) {
      setSavedScrollLeft(tableContainerRef.current.scrollLeft);
    }
  };

  useEffect(() => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollLeft = savedScrollLeft;
    }
  }, [page, savedScrollLeft]);

  
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [
          customersRes, 
          reportRes, 
          inTransitRes, 
          pendingRes, 
          overdueRes
        ] = await Promise.all([
          customerService.list({ pageSize: 1 }),
          reportService.getReport('all').catch(() => ({ revenue: 0 })),
          shipmentService.list({ status: 'in_transit', pageSize: 1 }),
          shipmentService.list({ status: 'pending', pageSize: 1 }),
          invoiceService.list({ overdue: 'true', pageSize: 1 })
        ]);

        setCustomerCount(customersRes.total || 0);
        setRevenue(reportRes.revenue || 0);
        setInTransitCount(inTransitRes.total || 0);
        setPendingCount(pendingRes.total || 0);
        setOverdueCount(overdueRes.total || 0);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      }
    };
    fetchDashboardData();
  }, []);

  
  useEffect(() => {
    let active = true;
    const fetchTableData = async () => {
      setIsLoading(true);
      try {
        const res = await shipmentService.list({ 
          status: activeTab === 'all' ? undefined : activeTab, 
          page, 
          pageSize 
        });
        if (!active) return;
        setShipments(res.data);
        setTotal(res.total);
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    fetchTableData();
    return () => { active = false; };
  }, [activeTab, page, pageSize]);

  const adminStats = useMemo(() => [
    { label: 'Customers', value: customerCount.toLocaleString(), icon: Users, trend: '9.8%', trendUp: true, color: 'var(--color-primary)', link: '/admin/customers' },
    { label: 'Revenue', value: formatCurrency(revenue, 'NGN'), icon: DollarSign, trend: '5.9%', trendUp: true, color: 'var(--color-primary)', link: '/admin/invoices' },
    { label: 'In Transit', value: inTransitCount.toLocaleString(), icon: Activity, trend: '2.1%', trendUp: false, color: 'var(--color-primary)', link: '/admin/shipments' },
    { 
      label: 'Attention', 
      value: String(pendingCount + overdueCount), 
      icon: AlertTriangle, 
      trend: 'Pending/Overdue', 
      trendUp: false, 
      color: 'var(--color-danger, #c62828)', 
      isAlert: true,
      breakdown: [
        { label: 'Pending shipments', count: pendingCount, link: '/admin/shipments' },
        { label: 'Overdue invoices', count: overdueCount, link: '/admin/invoices' }
      ]
    },
  ], [customerCount, revenue, inTransitCount, pendingCount, overdueCount]);

  const totalPages = Math.ceil(total / pageSize);

  const exportRows = shipments.map((shipment) => ({
    orderId: shipment.orderId,
    category: shipment.natureOfItem,
    weight: `${shipment.weight.toLocaleString()} ${shipment.weightUnit}`,
    company: `${shipment.customer?.firstname || 'Unknown'} ${shipment.customer?.lastname || ''}`.trim(),
    arrivalTime: formatDate(shipment.createdAt),
    route: `${shipment.originAddress?.split(',')[0] || 'Unknown'} - ${shipment.destinationAddress?.split(',')[0] || 'Unknown'}`,
    shipper: 'DHL',
    price: formatCurrency(shipment.invoiceValue, shipment.invoiceCurrency),
    status: shipment.status,
  }));

  const toggleRow = (id: string) => {
    const next = new Set(selectedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRows(next);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setPage(1);
    setSelectedRows(new Set());
  };

  return (
    <PageWrapper title={`Welcome ${admin?.name || 'Admin'}!`}>
      {}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 32 }}>
        {adminStats.map((stat) => (
          <div key={stat.label} style={{ 
            background: 'var(--color-surface)', 
            borderRadius: '12px', 
            border: '1px solid rgba(0,0,0,0.04)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
          }}>
            <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: 12, fontWeight: 500 }}>
                  {stat.label}
                </div>
                <div style={{ fontSize: '32px', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                  {stat.value}
                </div>
              </div>
              <div style={{ 
                width: 32, height: 32, borderRadius: '8px', 
                background: 'var(--color-surface)', 
                border: '1px solid rgba(0,0,0,0.04)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-text-secondary)'
              }}>
                <stat.icon size={16} />
              </div>
            </div>
            <div style={{ 
              padding: '16px 24px', 
              borderTop: '1px solid rgba(0,0,0,0.03)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center' 
            }}>
              <div style={{ fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: stat.trendUp ? '#10b981' : '#ef4444' }}>
                  {stat.trendUp ? '↗' : '↘'} {stat.trend}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>Last month</span>
              </div>
              {stat.breakdown ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                      View more
                    </div>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="radix-dropdown-menu" sideOffset={5} align="end" style={{ zIndex: 100, minWidth: 220 }}>
                      <div style={{ padding: '8px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Attention Required
                      </div>
                      {stat.breakdown.map((item, i) => (
                        <DropdownMenu.Item key={i} className="dropdown-item" onClick={() => navigate(item.link)}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                            <span>{item.label}</span>
                            <span style={{ fontWeight: 600, background: 'var(--color-danger-light, #fce8e8)', color: 'var(--color-danger, #c62828)', padding: '2px 8px', borderRadius: 'var(--radius-badge)', fontSize: '12px' }}>
                              {item.count}
                            </span>
                          </div>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : (
                <div 
                  style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' }}
                  onClick={() => stat.link && navigate(stat.link)}
                >
                  View more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Table Section */}
      <div style={{ 
        background: 'var(--color-surface)', 
        borderRadius: '12px', 
        border: '1px solid rgba(0,0,0,0.04)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        overflow: 'hidden'
      }}>
        {/* Table Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '20px 24px', 
          borderBottom: '1px solid rgba(0,0,0,0.04)',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Recent Activities
            </h2>
            <div className="tabs" style={{ margin: 0 }}>
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  className={`tab ${activeTab === tab.value ? 'active' : ''}`}
                  onClick={() => handleTabChange(tab.value)}
                >
                  {tab.value === 'all' && <span className="tab-dot" />}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="btn btn-ghost" onClick={() => setExportOpen(true)}>
              <SlidersHorizontal size={16} />
              Export Data
            </button>
            <div className="pagination" style={{ borderTop: 'none', padding: 0 }}>
              <span className="pagination-info" style={{ marginRight: 8 }}>
                {total > 0 ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}` : '0-0 of 0'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button 
                  className="pagination-btn" 
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <button 
                  className="pagination-btn"
                  disabled={page === totalPages || total === 0}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

      {/* Table */}
      <div className="vhi-table-container" ref={tableContainerRef} onScroll={handleScroll}>
        <table className="vhi-table">
          <thead>
            <tr>
              <th style={{ width: 40, paddingLeft: 16 }}>
                <input
                  type="checkbox"
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                  checked={shipments.length > 0 && shipments.every(s => selectedRows.has(s.id))}
                  onChange={() => {
                    const allSelected = shipments.every(s => selectedRows.has(s.id));
                    const next = new Set(selectedRows);
                    shipments.forEach(s => {
                      if (allSelected) next.delete(s.id);
                      else next.add(s.id);
                    });
                    setSelectedRows(next);
                  }}
                />
              </th>
              <th>Order ID</th>
              <th>Category</th>
              <th>Weight</th>
              <th>Company</th>
              <th>Arrival time</th>
              <th>Route</th>
              <th>Shipper</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th>Status</th>
              <th style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
                  Loading shipments...
                </td>
              </tr>
            ) : shipments.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
                  No shipments found.
                </td>
              </tr>
            ) : (
              shipments.map((shipment) => (
                <tr key={shipment.id}>
                  <td style={{ paddingLeft: 16 }}>
                    <input
                      type="checkbox"
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                      checked={selectedRows.has(shipment.id)}
                      onChange={() => toggleRow(shipment.id)}
                    />
                  </td>
                  <td style={{ fontWeight: 500 }}>{shipment.orderId}</td>
                  <td>{shipment.natureOfItem}</td>
                  <td>{shipment.weight.toLocaleString()}{shipment.weightUnit}</td>
                  <td>{shipment.customer?.firstname} {shipment.customer?.lastname}</td>
                  <td>{formatDate(shipment.createdAt)}</td>
                  <td>{shipment.originAddress?.split(',')[0] || 'Unknown'} - {shipment.destinationAddress?.split(',')[0] || 'Unknown'}</td>
                  <td style={{ color: 'var(--color-text-muted)' }}>DHL</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(shipment.invoiceValue, shipment.invoiceCurrency)}</td>
                  <td>
                    <Badge status={shipment.status} type="shipment" />
                  </td>
                  <td style={{ position: 'relative' }}>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button className="btn btn-icon btn-ghost">
                          <MoreVertical size={18} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="radix-dropdown-menu" sideOffset={5} align="end" style={{ zIndex: 100 }}>
                          <DropdownMenu.Item className="dropdown-item" onClick={() => navigate(`/admin/shipments/${shipment.id}`)}>
                            View details
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="dropdown-item">
                            Edit shipment
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      <ExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        selectedCount={selectedRows.size}
        rows={exportRows}
        fileName="overview-shipments.csv"
      />
    </PageWrapper>
  );
}
