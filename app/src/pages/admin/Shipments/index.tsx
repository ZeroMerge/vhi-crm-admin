import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, MoreVertical, SlidersHorizontal, Package, X, AlertTriangle } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { ExportModal } from '@/components/shared/ExportModal';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import { shipmentService } from '@/services/shipment.service';
import { useAuthStore } from '@/store/authStore';
import type { Shipment } from '@/types';

const statuses = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'clearance', label: 'Clearance' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const modes = [
  { value: '', label: 'All Modes' },
  { value: 'air_freight', label: 'Air Freight' },
  { value: 'groupage', label: 'Groupage' },
  { value: 'consolidation', label: 'Consolidation' },
  { value: 'china_groupage', label: 'China Groupage' },
  { value: 'cargo_clearing', label: 'Cargo Clearing' },
  { value: 'export', label: 'Export' },
];

const sorts = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'price_desc', label: 'Price: High-Low' },
  { value: 'price_asc', label: 'Price: Low-High' },
];

export default function Shipments() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const isSupportStaff = admin?.activeRole === 'support_staff';

  const [searchParams, setSearchParams] = useSearchParams();

  // Read filter state from URL parameters
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const mode = searchParams.get('mode') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const sortBy = searchParams.get('sortBy') || 'newest';
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = 10;

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [openMenuIdx, setOpenMenuIdx] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const fetchShipments = async () => {
      setLoading(true);
      try {
        const response = await shipmentService.list({
          search,
          status,
          mode,
          dateFrom,
          dateTo,
          sortBy,
          page,
          pageSize,
        });
        if (active) {
          setShipments(response.data);
          setTotal(response.total);
        }
      } catch (err) {
        console.error('Failed to load shipments:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchShipments();
    return () => {
      active = false;
    };
  }, [search, status, mode, dateFrom, dateTo, sortBy, page]);

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    newParams.set('page', '1'); // Reset to page 1
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const isFilterActive = !!(search || status || mode || dateFrom || dateTo || sortBy !== 'newest');

  // Handle pagination clicks
  const totalPages = Math.ceil(total / pageSize);
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', String(newPage));
    setSearchParams(newParams);
  };

  return (
    <PageWrapper title="Shipments">
      {/* Stats bar */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: 'var(--color-primary)', borderRadius: 'var(--border-radius-pill)', marginBottom: 24 }}>
        <Package size={20} color="white" />
        <span style={{ color: 'white', fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
          Total Shipments: {total.toLocaleString()}
        </span>
      </div>

      {/* Page-adaptive filter bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 24,
          flexWrap: 'wrap',
          background: 'var(--color-surface)',
          padding: '16px',
          borderRadius: 'var(--border-radius-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Search input on left */}
        <div className="search-input-wrapper" style={{ maxWidth: 220 }}>
          <Search size={18} className="search-icon" />
          <input
            className="input"
            placeholder="Search order ID, item, name..."
            value={search}
            onChange={(e) => updateFilter('search', e.target.value)}
          />
        </div>

        {/* Filters in middle */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {status && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-primary)',
                zIndex: 2,
              }}
            />
          )}
          <select
            className="select"
            value={status}
            onChange={(e) => updateFilter('status', e.target.value)}
            style={{
              borderColor: status ? 'var(--color-primary)' : 'var(--color-border)',
              paddingRight: 32,
            }}
          >
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {mode && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-primary)',
                zIndex: 2,
              }}
            />
          )}
          <select
            className="select"
            value={mode}
            onChange={(e) => updateFilter('mode', e.target.value)}
            style={{
              borderColor: mode ? 'var(--color-primary)' : 'var(--color-border)',
              paddingRight: 32,
            }}
          >
            {modes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date pickers inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-xs)' }}>
          <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>From:</span>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--border-radius-input)',
              width: 130,
              fontSize: 'var(--font-size-xs)',
              borderColor: dateFrom ? 'var(--color-primary)' : 'var(--color-border)',
            }}
          />
          <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>To:</span>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--border-radius-input)',
              width: 130,
              fontSize: 'var(--font-size-xs)',
              borderColor: dateTo ? 'var(--color-primary)' : 'var(--color-border)',
            }}
          />
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {sortBy !== 'newest' && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-primary)',
                zIndex: 2,
              }}
            />
          )}
          <select
            className="select"
            value={sortBy}
            onChange={(e) => updateFilter('sortBy', e.target.value)}
            style={{
              borderColor: sortBy !== 'newest' ? 'var(--color-primary)' : 'var(--color-border)',
              paddingRight: 32,
            }}
          >
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
        </div>

        {isFilterActive && (
          <button
            onClick={clearAllFilters}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <X size={16} />
            Clear
          </button>
        )}

        {/* Export / Action on right */}
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setExportOpen(true)}>
          <SlidersHorizontal size={16} />
          Customize Export
        </button>
      </div>

      {isSupportStaff && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--color-primary-light)',
            color: 'var(--color-primary)',
            padding: '10px 16px',
            borderRadius: 'var(--border-radius-sm)',
            fontSize: 'var(--font-size-xs)',
            marginBottom: '16px',
            fontWeight: 500,
          }}
        >
          <AlertTriangle size={14} />
          <span>You are logged in with the read-only Support Staff role. Action buttons are disabled.</span>
        </div>
      )}

      {/* Table */}
      <div className="vhi-table-container">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Loading shipments...
          </div>
        ) : (
          <table className="vhi-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" style={{ width: 16, height: 16 }} />
                </th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Mode</th>
                <th>Weight</th>
                <th>Route</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th>Status</th>
                <th style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {shipments.map((s, idx) => (
                <tr key={s.id} onClick={() => navigate(`/admin/shipments/${s.id}`)} style={{ cursor: 'pointer' }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" style={{ width: 16, height: 16 }} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{s.orderId}</td>
                  <td>
                    {s.customer ? `${s.customer.firstname} ${s.customer.lastname}` : 'Unknown Customer'}
                  </td>
                  <td>
                    <Badge status={s.shippingMode} type="shipment" size="sm" />
                  </td>
                  <td>
                    {s.weight.toLocaleString()} {s.weightUnit}
                  </td>
                  <td>
                    {s.originAddress?.split(',')[0] || 'Unknown'} → {s.destinationAddress?.split(',')[0] || 'Unknown'}
                  </td>
                  <td>{formatDate(s.createdAt)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>
                    {formatCurrency(s.invoiceValue, s.invoiceCurrency)}
                  </td>
                  <td>
                    <Badge status={s.status} type="shipment" />
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
                    <button
                      className="btn btn-icon btn-ghost"
                      onClick={() => setOpenMenuIdx(openMenuIdx === idx ? null : idx)}
                    >
                      <MoreVertical size={18} />
                    </button>
                    {openMenuIdx === idx && (
                      <div className="dropdown-menu" style={{ right: 0, top: '100%' }}>
                        <button
                          className="dropdown-item"
                          onClick={() => {
                            setOpenMenuIdx(null);
                            navigate(`/admin/shipments/${s.id}`);
                          }}
                        >
                          View Details
                        </button>
                        {!isSupportStaff && (
                          <>
                            <button
                              className="dropdown-item"
                              onClick={() => {
                                setOpenMenuIdx(null);
                                navigate(`/admin/shipments/${s.id}?action=status`);
                              }}
                            >
                              Update Status
                            </button>
                            <button
                              className="dropdown-item"
                              onClick={() => {
                                setOpenMenuIdx(null);
                                alert('Printing label...');
                              }}
                            >
                              Print Label
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && shipments.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search size={32} />
            </div>
            <div className="empty-state-title">No shipments found</div>
            <div className="empty-state-desc">Try adjusting your filters</div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <div className="pagination">
            <span className="pagination-info">
              {Math.min((page - 1) * pageSize + 1, total)}-{Math.min(page * pageSize, total)} of {total}
            </span>
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(page + 1)}
              disabled={page === totalPages}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} />
    </PageWrapper>
  );
}
