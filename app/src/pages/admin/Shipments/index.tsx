import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, MoreVertical, SlidersHorizontal, Package, X, AlertTriangle, Plus } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { DatePicker } from '@/components/ui/date-picker';
import { ExportModal } from '@/components/shared/ExportModal';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import { shipmentService } from '@/services/shipment.service';
import { useAuthStore } from '@/store/authStore';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { SearchX } from 'lucide-react';
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
    newParams.set('page', '1'); 
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const isFilterActive = !!(search || status || mode || dateFrom || dateTo || sortBy !== 'newest');

  
  const totalPages = Math.ceil(total / pageSize);
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', String(newPage));
    setSearchParams(newParams);
  };

  return (
    <PageWrapper title="Shipments">
      {}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: 'var(--color-primary)', borderRadius: 'var(--radius-badge)', marginBottom: 24 }}>
        <Package size={20} color="white" />
        <span style={{ color: 'white', fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
          Total Shipments: {(total ?? 0).toLocaleString()}
        </span>
      </div>

      {/* Table Section */}
      <div style={{ 
        background: 'var(--color-surface)', 
        borderRadius: '12px', 
        border: '1px solid rgba(0,0,0,0.04)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        overflow: 'hidden',
        marginBottom: 24
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
          {/* Left Side: Search & Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
          <CustomSelect
            value={status}
            onChange={(val) => updateFilter('status', val)}
            options={statuses}
            style={{ borderColor: status ? 'var(--color-primary)' : 'var(--color-border)' }}
          />
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
          <CustomSelect
            value={mode}
            onChange={(val) => updateFilter('mode', val)}
            options={modes}
            style={{ borderColor: mode ? 'var(--color-primary)' : 'var(--color-border)' }}
          />
        </div>

        {/* Date pickers inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-xs)' }}>
          <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>From:</span>
          <DatePicker
            value={dateFrom}
            onChange={(date) => updateFilter('dateFrom', date ? date.toISOString() : '')}
            className="w-[130px]"
          />
          <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>To:</span>
          <DatePicker
            value={dateTo}
            onChange={(date) => updateFilter('dateTo', date ? date.toISOString() : '')}
            className="w-[130px]"
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
          <CustomSelect
            value={sortBy}
            onChange={(val) => updateFilter('sortBy', val)}
            options={sorts.map(s => ({ ...s, label: `Sort: ${s.label}` }))}
            style={{ borderColor: sortBy !== 'newest' ? 'var(--color-primary)' : 'var(--color-border)' }}
          />
        </div>

        {isFilterActive && (
          <button onClick={clearAllFilters} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 'var(--font-size-sm)', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <X size={16} /> Clear
          </button>
        )}
          </div>

          {}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="btn btn-ghost" onClick={() => setExportOpen(true)}>
              <SlidersHorizontal size={16} /> Export
            </button>
            {!isSupportStaff && (
              <button className="btn btn-primary" onClick={() => navigate('/admin/shipments/new')} id="btn-new-shipment">
                <Plus size={16} /> New Shipment
              </button>
            )}
            
            <div className="pagination" style={{ borderTop: 'none', padding: 0, margin: 0 }}>
              <span className="pagination-info" style={{ marginRight: 8 }}>
                {total > 0 ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}` : '0-0 of 0'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="pagination-btn" onClick={() => handlePageChange(page - 1)} disabled={page === 1}>
                  <ChevronLeft size={16} />
                </button>
                <button className="pagination-btn" onClick={() => handlePageChange(page + 1)} disabled={page === Math.ceil(total / pageSize) || total === 0}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {isSupportStaff && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '10px 16px', fontSize: 'var(--font-size-xs)', fontWeight: 500, borderBottom: '1px solid var(--color-border)' }}>
            <AlertTriangle size={14} />
            <span>You are logged in with the read-only Support Staff role. Action buttons are disabled.</span>
          </div>
        )}

        {/* Table */}
        <div className="vhi-table-container" style={{ overflow: 'visible', borderRadius: 0, border: 'none' }}>
        <div style={{ overflowX: 'auto' }}>
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
              {shipments.map((s) => (
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
                    {(s.weight ?? 0).toLocaleString()} {s.weightUnit || ''}
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
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button className="btn btn-icon btn-ghost">
                          <MoreVertical size={18} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="radix-dropdown-menu" sideOffset={5} align="end" style={{ zIndex: 100 }}>
                          <DropdownMenu.Item className="dropdown-item" onClick={() => navigate(`/admin/shipments/${s.id}`)}>
                            View Details
                          </DropdownMenu.Item>
                          {!isSupportStaff && (
                            <>
                              <DropdownMenu.Item className="dropdown-item" onClick={() => navigate(`/admin/shipments/${s.id}?action=status`)}>
                                Update Status
                              </DropdownMenu.Item>
                              <DropdownMenu.Item className="dropdown-item" onClick={() => alert('Printing label...')}>
                                Print Label
                              </DropdownMenu.Item>
                            </>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </td>
                </tr>
              ))}
              
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skel-${i}`}>
                  <td><div className="skeleton" style={{ width: 16, height: 16, borderRadius: 4 }} /></td>
                  <td><div className="skeleton" style={{ width: 100, height: 16 }} /></td>
                  <td><div className="skeleton" style={{ width: 140, height: 16 }} /></td>
                  <td><div className="skeleton" style={{ width: 80, height: 24, borderRadius: 'var(--radius-badge)' }} /></td>
                  <td><div className="skeleton" style={{ width: 60, height: 16 }} /></td>
                  <td><div className="skeleton" style={{ width: 120, height: 16 }} /></td>
                  <td><div className="skeleton" style={{ width: 90, height: 16 }} /></td>
                  <td><div className="skeleton" style={{ width: 80, height: 16, marginLeft: 'auto' }} /></td>
                  <td><div className="skeleton" style={{ width: 90, height: 24, borderRadius: 'var(--radius-badge)' }} /></td>
                  <td><div className="skeleton" style={{ width: 32, height: 32, borderRadius: 16 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && shipments.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', background: 'var(--color-surface)', borderRadius: '0 0 var(--border-radius-card) var(--border-radius-card)', border: '1px solid var(--color-border)', borderTop: 'none' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-page-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <SearchX size={32} color="var(--color-text-muted)" />
            </div>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', marginBottom: 8 }}>No shipments found</div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'center', maxWidth: 400 }}>
              There are no records matching your current filters. Adjust your search criteria or create a new shipment.
            </div>
          </div>
        )}
      </div>
      </div>

      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} />
    </PageWrapper>
  );
}
