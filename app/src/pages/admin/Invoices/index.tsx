import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Plus, AlarmClock, MoreVertical, X, AlertTriangle } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import { invoiceService } from '@/services/invoice.service';
import { customerService } from '@/services/customer.service';
import { shipmentService } from '@/services/shipment.service';
import { useAuthStore } from '@/store/authStore';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { Invoice, Customer, Shipment } from '@/types';

const statuses = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Quotation/Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_vendor', label: 'Awaiting Vendor' },
  { value: 'awaiting_vendor_feedback', label: 'Awaiting Vendor Feedback' },
  { value: 'part_paid', label: 'Part Paid' },
  { value: 'paid', label: 'Paid' },
];

const currencies = [
  { value: '', label: 'All Currencies' },
  { value: 'NGN', label: 'NGN' },
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
  { value: 'CAD', label: 'CAD' },
  { value: 'CNY', label: 'CNY' },
];

const sorts = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'amount_desc', label: 'Amount: High-Low' },
  { value: 'amount_asc', label: 'Amount: Low-High' },
];

export default function Invoices() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const isSupportStaff = admin?.activeRole === 'support_staff';

  const [searchParams, setSearchParams] = useSearchParams();

  
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const currency = searchParams.get('currency') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const overdue = searchParams.get('overdue') === 'true';
  const sortBy = searchParams.get('sortBy') || 'newest';
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = 10;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [shipmentsList, setShipmentsList] = useState<Shipment[]>([]);
  
  
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formShipmentId, setFormShipmentId] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState('NGN');
  const [formDueDate, setFormDueDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchInvoices = async () => {
      setLoading(true);
      try {
        const response = await invoiceService.list({
          search,
          status,
          currency,
          dateFrom,
          dateTo,
          overdue: overdue ? 'true' : '',
          sortBy,
          page,
          pageSize,
        });
        if (active) {
          setInvoices(response.data);
          setTotal(response.total);
        }
      } catch (err) {
        console.error('Failed to load invoices:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchInvoices();
    return () => {
      active = false;
    };
  }, [search, status, currency, dateFrom, dateTo, overdue, sortBy, page]);

  
  useEffect(() => {
    if (showCreate) {
      const loadChoices = async () => {
        try {
          const custRes = await customerService.list({ page: 1, pageSize: 100 });
          const shipRes = await shipmentService.list({ page: 1, pageSize: 100 });
          setCustomersList(custRes.data);
          setShipmentsList(shipRes.data);
        } catch (err) {
          console.error(err);
        }
      };
      loadChoices();
    }
  }, [showCreate]);

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

  const toggleOverdueFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    if (!overdue) {
      newParams.set('overdue', 'true');
    } else {
      newParams.delete('overdue');
    }
    newParams.set('page', '1');
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const isFilterActive = !!(search || status || currency || dateFrom || dateTo || overdue || sortBy !== 'newest');

  const isFollowUpOverdue = (invoice: Invoice) => {
    if (!invoice.followUpDate) return false;
    return new Date(invoice.followUpDate) < new Date() && invoice.status !== 'paid';
  };

  
  const totalPages = Math.ceil(total / pageSize);
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', String(newPage));
    setSearchParams(newParams);
  };

  const checkOverdue = (dueDate: string, status: string) => {
    return new Date(dueDate) < new Date() && status !== 'paid';
  };

  const handleCreateInvoice = async () => {
    if (!formCustomerId || !formShipmentId || !formAmount || !formDueDate) {
      alert('Please fill in all required fields.');
      return;
    }
    
    setCreateLoading(true);
    try {
      await invoiceService.create({
        customerId: formCustomerId,
        shipmentId: formShipmentId,
        amount: parseFloat(formAmount),
        currency: formCurrency,
        dueDate: formDueDate,
        notes: formNotes,
      });
      setShowCreate(false);
      
      setFormCustomerId('');
      setFormShipmentId('');
      setFormAmount('');
      setFormCurrency('NGN');
      setFormDueDate('');
      setFormNotes('');
      
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert('Failed to create invoice.');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this invoice?')) {
      try {
        await invoiceService.delete(id);
        window.location.reload();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === invoices.length && invoices.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map((i) => i.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  return (
    <PageWrapper title="Invoices">
      {}
      <div className="two-col-layout" style={{ gap: 20, marginBottom: 24 }}>
        <div>
          {}
          <div
            className="filter-toolbar"
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
        {}
        <div className="search-input-wrapper" style={{ maxWidth: 220 }}>
          <Search size={18} className="search-icon" />
          <input
            className="input"
            placeholder="Search invoice number..."
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
          {currency && (
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
            value={currency}
            onChange={(val) => updateFilter('currency', val)}
            options={currencies}
            style={{ borderColor: currency ? 'var(--color-primary)' : 'var(--color-border)' }}
          />
        </div>

        {/* Dates */}
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

        {}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
            Overdue Only:
          </span>
          <div
            className={`toggle-track ${overdue ? 'active' : ''}`}
            onClick={toggleOverdueFilter}
          >
            <div className="toggle-thumb" />
          </div>
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

          </div>
        </div>

        <div className="col-right">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--color-surface)', borderRadius: 'var(--border-radius-card)', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Invoices</div>
              <div style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>{(total ?? 0).toLocaleString()}</div>
            </div>
            {!isSupportStaff && (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={16} /> Create Invoice
              </button>
            )}
          </div>
        </div>
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

      {}
      <div className="vhi-table-container">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Loading invoices...
          </div>
        ) : (
          <table className="vhi-table">
            <thead>
              <tr>
                <th style={{ width: 40, paddingLeft: 16 }}>
                  <input 
                    type="checkbox" 
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                    checked={invoices.length > 0 && selectedIds.size === invoices.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Invoice No</th>
                <th>Customer</th>
                <th>Shipment ID</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Currency</th>
                <th>Status</th>
                <th>Due Date</th>
                <th style={{ width: 50 }} />
                <th style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} onClick={() => navigate(`/admin/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                  <td onClick={(e) => e.stopPropagation()} style={{ paddingLeft: 16 }}>
                    <input 
                      type="checkbox" 
                      style={{ width: 16, height: 16, cursor: 'pointer' }} 
                      checked={selectedIds.has(inv.id)}
                      onChange={() => toggleSelect(inv.id)}
                    />
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isFollowUpOverdue(inv) && <AlarmClock size={14} color="var(--color-status-cancelled-text)" />}
                      <span>{inv.invoiceNumber}</span>
                    </div>
                  </td>
                  <td>
                    {inv.customer ? `${inv.customer.firstname} ${inv.customer.lastname}` : 'Unknown Customer'}
                  </td>
                  <td>{inv.shipment?.orderId || inv.shipmentId}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>
                    {formatCurrency(inv.amount, inv.currency)}
                  </td>
                  <td>{inv.currency}</td>
                  <td>
                    <Badge status={inv.status} type="invoice" />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {formatDate(inv.dueDate)}
                      {checkOverdue(inv.dueDate, inv.status) && (
                        <AlarmClock size={16} color="var(--color-status-pending-text)" />
                      )}
                    </div>
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
                          <DropdownMenu.Item className="dropdown-item" onClick={() => navigate(`/admin/invoices/${inv.id}`)}>
                            View Details
                          </DropdownMenu.Item>
                          <DropdownMenu.Item className="dropdown-item" onClick={() => alert('Downloading invoice PDF...')}>
                            Download PDF
                          </DropdownMenu.Item>
                          {!isSupportStaff && (
                            <>
                              <DropdownMenu.Item className="dropdown-item" onClick={() => navigate(`/admin/invoices/${inv.id}`)}>
                                Edit Status
                              </DropdownMenu.Item>
                              <DropdownMenu.Item className="dropdown-item" onClick={() => navigate(`/admin/invoices/${inv.id}`)}>
                                Record Payment
                              </DropdownMenu.Item>
                              <DropdownMenu.Item className="dropdown-item danger" onClick={() => handleDeleteInvoice(inv.id)}>
                                Delete
                              </DropdownMenu.Item>
                            </>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && invoices.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search size={32} />
            </div>
            <div className="empty-state-title">No invoices found</div>
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

      {/* Create Invoice Modal */}
      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Invoice"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setShowCreate(false)} disabled={createLoading}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleCreateInvoice} disabled={createLoading}>
              {createLoading ? 'Creating...' : 'Create Invoice'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Customer *</label>
            <CustomSelect
              value={formCustomerId}
              onChange={setFormCustomerId}
              options={[
                { value: '', label: 'Select customer...' },
                ...customersList.map((c) => ({ value: c.id, label: `${c.firstname} ${c.lastname} (${c.userId})` }))
              ]}
              width="100%"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Shipment *</label>
            <CustomSelect
              value={formShipmentId}
              onChange={setFormShipmentId}
              options={[
                { value: '', label: 'Select shipment...' },
                ...shipmentsList
                  .filter((s) => !formCustomerId || s.customerId === formCustomerId)
                  .map((s) => ({ value: s.id, label: `${s.orderId} - ${s.natureOfItem}` }))
              ]}
              width="100%"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Amount *</label>
              <input
                className="input"
                type="number"
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Currency *</label>
              <CustomSelect
                value={formCurrency}
                onChange={setFormCurrency}
                options={[
                  { value: 'NGN', label: 'NGN' },
                  { value: 'USD', label: 'USD' },
                  { value: 'EUR', label: 'EUR' },
                  { value: 'GBP', label: 'GBP' },
                  { value: 'CAD', label: 'CAD' },
                  { value: 'CNY', label: 'CNY' },
                ]}
                width="100%"
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Due Date *</label>
            <DatePicker
              value={formDueDate}
              onChange={(date) => setFormDueDate(date ? date.toISOString() : '')}
              className="w-full"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="input"
              placeholder="Optional notes..."
              rows={3}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              style={{
                borderRadius: 'var(--border-radius-card)',
                resize: 'vertical',
                width: '100%',
              }}
            />
          </div>
        </div>
      </Modal>
    </PageWrapper>
  );
}
