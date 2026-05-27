import { useState, useRef, useEffect } from 'react';
import { Package, MapPin, AlertTriangle, Plus, MoreVertical, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { ExportModal } from '@/components/shared/ExportModal';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import type { Shipment, ShipmentStatus } from '@/types';

// Mock data matching the design
const mockShipments: Shipment[] = Array.from({ length: 10 }, (_, i) => ({
  id: `ship-${i}`,
  orderId: i === 0 ? '#1895-67-fw' : i === 1 ? '#2695-77-gw' : `#${1000 + i}-88-xx`,
  customerId: 'cust-1',
  shippingMode: 'air_freight',
  deliveryMode: 'door_to_door',
  natureOfItem: i % 2 === 0 ? 'Building material' : 'Electronics',
  hsCode: '392690',
  invoiceValue: i % 2 === 0 ? 34000000 : 12500000,
  invoiceCurrency: 'NGN',
  weight: i % 2 === 0 ? 365000 : 50000,
  weightUnit: 'kg',
  originAddress: 'London, UK',
  destinationAddress: 'Prague, Czech Republic',
  portOfDischarge: '',
  awbNumber: '',
  bolNumber: '',
  uniqueId: '',
  status: (['delivered', 'delivered', 'delivered', 'delivered', 'in_transit', 'delivered', 'delivered', 'pending', 'delivered', 'delivered'][i]) as ShipmentStatus,
  isDraft: false,
  customer: { id: 'cust-1', userId: 'USR001', firstname: 'NGR', lastname: 'Ominglo', email: 'ngr@example.com', phone: '+2348012345678', industry: 'manufacturing', starRating: 4, status: 'loyal', newsletterPrefs: [], isActive: true, createdAt: '2024-01-15T10:00:00Z' },
  createdAt: '2024-03-12T10:00:00Z',
  updatedAt: '2024-03-12T10:00:00Z',
}));

const tabs: { label: string; value: string; count?: number }[] = [
  { label: 'All', value: 'all' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'In transit', value: 'in_transit' },
  { label: 'Pending', value: 'pending' },
  { label: 'Processing', value: 'processing' },
];

const stats = [
  { label: 'Total Shipments', value: '120', icon: Package },
  { label: 'Active Tracking', value: '64', icon: MapPin },
];

export default function Overview() {
  const [activeTab, setActiveTab] = useState('all');
  const [exportOpen, setExportOpen] = useState(false);
  const [openMenuIdx, setOpenMenuIdx] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const pendingCount = 5;

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [savedScrollLeft, setSavedScrollLeft] = useState(0);

  // Capture scroll position as the user scrolls
  const handleScroll = () => {
    if (tableContainerRef.current) {
      setSavedScrollLeft(tableContainerRef.current.scrollLeft);
    }
  };

  // Restore the horizontal scroll position whenever page changes
  useEffect(() => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollLeft = savedScrollLeft;
    }
  }, [page, savedScrollLeft]);


  const filteredShipments = activeTab === 'all'
    ? mockShipments
    : mockShipments.filter((s) => s.status === activeTab);

  const total = filteredShipments.length;
  const totalPages = Math.ceil(total / pageSize);
  const paginatedShipments = filteredShipments.slice((page - 1) * pageSize, page * pageSize);

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
    <PageWrapper title={`Welcome ${'Jane'}!`}>
      {/* Stats + Alert + Action Row */}
      {pendingCount > 0 && (
        <div className="alert-banner" style={{ display: 'flex', width: '100%', marginBottom: 20 }}>
          <AlertTriangle size={20} />
          <span>You got {pendingCount} pending shipments</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 32, flexWrap: 'wrap', width: '100%' }}>
        <div className="stats-grid" style={{ flex: 1, marginBottom: 0, minWidth: '280px' }}>
          {stats.map((stat, index) => {
            const isTotal = index === 0;
            const filledClass = isTotal ? 'card-filled-purple' : 'card-filled-pink';
            return (
              <div key={stat.label} className={`premium-card filled ${filledClass}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                  <div className="metric-icon-wrapper" style={{ width: 44, height: 44, borderRadius: 'var(--radius-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <stat.icon size={22} />
                  </div>
                  <span className="metric-label" style={{ fontSize: 'var(--font-size-sm)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</span>
                </div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-4xl)', fontWeight: 700 }}>
                  {stat.value}
                </div>
              </div>
            );
          })}
        </div>
        <button className="btn btn-primary btn-lg btn-responsive" onClick={() => {}}>
          <Plus size={18} />
          Create shipment
        </button>
      </div>

      {/* Table Header */}
      <div className="table-header-row">
        <div className="table-header-left">
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Recent Activities
          </h2>
          <div className="tabs">
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
        <div className="table-header-right">
          <button className="btn btn-ghost" onClick={() => setExportOpen(true)}>
            <SlidersHorizontal size={16} />
            Customize
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
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={paginatedShipments.length > 0 && paginatedShipments.every(s => selectedRows.has(s.id))}
                  onChange={() => {
                    const allSelected = paginatedShipments.every(s => selectedRows.has(s.id));
                    const next = new Set(selectedRows);
                    paginatedShipments.forEach(s => {
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
            {paginatedShipments.map((shipment, idx) => (
              <tr key={shipment.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedRows.has(shipment.id)}
                    onChange={() => toggleRow(shipment.id)}
                  />
                </td>
                <td style={{ fontWeight: 500 }}>{shipment.orderId}</td>
                <td>{shipment.natureOfItem}</td>
                <td>{shipment.weight.toLocaleString()}{shipment.weightUnit}</td>
                <td>{shipment.customer?.firstname}- {shipment.customer?.lastname}</td>
                <td>{formatDate(shipment.createdAt)}</td>
                <td>{shipment.originAddress?.split(',')[0] || 'Unknown'} - {shipment.destinationAddress?.split(',')[0] || 'Unknown'}</td>
                <td style={{ color: 'var(--color-text-muted)' }}>DHL</td>
                <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(shipment.invoiceValue, shipment.invoiceCurrency)}</td>
                <td>
                  <Badge status={shipment.status} type="shipment" />
                </td>
                <td style={{ position: 'relative' }}>
                  <button
                    className="btn btn-icon btn-ghost"
                    onClick={() => setOpenMenuIdx(openMenuIdx === idx ? null : idx)}
                  >
                    <MoreVertical size={18} />
                  </button>
                  {openMenuIdx === idx && (
                    <div className="dropdown-menu" style={{ right: 0, top: '100%' }}>
                      <button className="dropdown-item" onClick={() => setOpenMenuIdx(null)}>View Details</button>
                      <button className="dropdown-item" onClick={() => setOpenMenuIdx(null)}>Update Status</button>
                      <button className="dropdown-item" onClick={() => setOpenMenuIdx(null)}>Print</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} selectedCount={selectedRows.size} />
    </PageWrapper>
  );
}
