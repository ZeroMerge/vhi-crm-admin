import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, MoreVertical, Download, X, AlertTriangle } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { StarRating } from '@/components/ui/StarRating';
import { formatDate } from '@/utils/formatDate';
import { customerService } from '@/services/customer.service';
import { useAuthStore } from '@/store/authStore';
import { Avatar } from '@/components/shared/Avatar';
import type { Customer } from '@/types';

const industries = [
  { value: '', label: 'All Industries' },
  { value: 'oil_gas', label: 'Oil & Gas' },
  { value: 'medical', label: 'Medical' },
  { value: 'pharma', label: 'Pharmaceutical' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'mining', label: 'Mining' },
  { value: 'others', label: 'Others' },
];

const statuses = [
  { value: '', label: 'All Statuses' },
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'returning', label: 'Returning' },
  { value: 'loyal', label: 'Loyal' },
];

const sorts = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name-a-z', label: 'Name A-Z' },
  { value: 'name-z-a', label: 'Name Z-A' },
  { value: 'star-high-low', label: 'Star (High-Low)' },
];

export default function Customers() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const isSupportStaff = admin?.activeRole === 'support_staff';

  const [searchParams, setSearchParams] = useSearchParams();

  // Read filter state from URL parameters
  const search = searchParams.get('search') || '';
  const industry = searchParams.get('industry') || '';
  const star = searchParams.get('star') || '';
  const status = searchParams.get('status') || '';
  const sortBy = searchParams.get('sortBy') || 'newest';
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = 10;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openMenuIdx, setOpenMenuIdx] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        const response = await customerService.list({
          search,
          industry,
          star,
          status,
          sortBy,
          page,
          pageSize,
        });
        if (active) {
          setCustomers(response.data);
          setTotal(response.total);
        }
      } catch (err) {
        console.error('Failed to load customers:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchCustomers();
    return () => {
      active = false;
    };
  }, [search, industry, star, status, sortBy, page]);

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    newParams.set('page', '1'); // Reset to page 1 on filter change
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const isFilterActive = !!(search || industry || star || status || sortBy !== 'newest');

  // Handle pagination clicks
  const totalPages = Math.ceil(total / pageSize);
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', String(newPage));
    setSearchParams(newParams);
  };

  const handleDeleteCustomer = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this customer?')) {
      try {
        await customerService.delete(id);
        // Refresh customer list
        window.location.reload();
      } catch (err) {
        console.error('Failed to delete customer:', err);
      }
    }
  };

  return (
    <PageWrapper title="Customers">
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
        {/* Search on left */}
        <div className="search-input-wrapper" style={{ maxWidth: 260 }}>
          <Search size={18} className="search-icon" />
          <input
            className="input"
            placeholder="Search name, email, user ID..."
            value={search}
            onChange={(e) => updateFilter('search', e.target.value)}
          />
        </div>

        {/* Filters in middle */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {industry && (
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
            value={industry}
            onChange={(e) => updateFilter('industry', e.target.value)}
            style={{
              borderColor: industry ? 'var(--color-primary)' : 'var(--color-border)',
              paddingRight: 32,
            }}
          >
            {industries.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {star && (
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
            value={star}
            onChange={(e) => updateFilter('star', e.target.value)}
            style={{
              borderColor: star ? 'var(--color-primary)' : 'var(--color-border)',
              paddingRight: 32,
            }}
          >
            <option value="">All Stars</option>
            {[1, 2, 3, 4, 5].map((s) => (
              <option key={s} value={String(s)}>
                {s} Star{s > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </div>

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
                Sort by: {s.label}
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
            Clear filters
          </button>
        )}

        {/* Action buttons on right */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              // Simulating export
              alert('Exporting customers list as CSV...');
            }}
          >
            <Download size={16} />
            Export CSV
          </button>
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

      {/* Table */}
      <div className="vhi-table-container">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Loading customers list...
          </div>
        ) : (
          <table className="vhi-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" style={{ width: 16, height: 16 }} />
                </th>
                <th>Name</th>
                <th>Email</th>
                <th>Industry</th>
                <th>Phone</th>
                <th>Star Rating</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {customers.map((customer, idx) => (
                <tr
                  key={customer.id}
                  onClick={() => navigate(`/admin/customers/${customer.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" style={{ width: 16, height: 16 }} />
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={`${customer.firstname} ${customer.lastname}`} size="sm" />
                      {customer.firstname} {customer.lastname}
                    </div>
                  </td>
                  <td>{customer.email}</td>
                  <td>
                    <Badge status={customer.industry} type="shipment" size="sm" />
                  </td>
                  <td>{customer.phone}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <StarRating value={customer.starRating} readOnly size={16} />
                  </td>
                  <td>
                    <Badge status={customer.status} type="customer" size="sm" />
                  </td>
                  <td style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
                    {formatDate(customer.createdAt)}
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
                          onClick={() => handleDropdownNavigate(`/admin/customers/${customer.id}`)}
                        >
                          View Detail
                        </button>
                        {!isSupportStaff && (
                          <>
                            <button
                              className="dropdown-item"
                              onClick={() => {
                                setOpenMenuIdx(null);
                                navigate(`/admin/customers/${customer.id}`);
                              }}
                            >
                              Edit Status
                            </button>
                            <button
                              className="dropdown-item danger"
                              onClick={() => {
                                setOpenMenuIdx(null);
                                handleDeleteCustomer(customer.id);
                              }}
                            >
                              Delete
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

        {!loading && customers.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search size={32} />
            </div>
            <div className="empty-state-title">No customers found</div>
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
    </PageWrapper>
  );

  function handleDropdownNavigate(path: string) {
    setOpenMenuIdx(null);
    navigate(path);
  }
}
