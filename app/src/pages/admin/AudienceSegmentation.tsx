import { useState } from 'react';
import { ArrowLeft, Search, Move } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import type { Customer, Industry } from '@/types';

const industries: { value: Industry; label: string }[] = [
  { value: 'oil_gas', label: 'Oil & Gas' },
  { value: 'medical', label: 'Medical' },
  { value: 'pharma', label: 'Pharmaceutical' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'mining', label: 'Mining & Construction' },
  { value: 'others', label: 'Others' },
];

const mockCustomers: Customer[] = [
  { id: '1', userId: 'USR001', firstname: 'Jane', lastname: 'Smith', email: 'jane@vhi.com', phone: '+2348012345678', industry: 'oil_gas', starRating: 4, status: 'loyal', newsletterPrefs: [], isActive: true, createdAt: '2024-01-15T10:00:00Z' },
  { id: '2', userId: 'USR002', firstname: 'John', lastname: 'Doe', email: 'john@vhi.com', phone: '+2348023456789', industry: 'medical', starRating: 3, status: 'prospect', newsletterPrefs: [], isActive: true, createdAt: '2024-02-20T08:30:00Z' },
  { id: '3', userId: 'USR003', firstname: 'Sarah', lastname: 'Lee', email: 'sarah@vhi.com', phone: '+2348034567890', industry: 'pharma', starRating: 5, status: 'loyal', newsletterPrefs: [], isActive: true, createdAt: '2024-03-05T14:15:00Z' },
  { id: '4', userId: 'USR004', firstname: 'Mike', lastname: 'Brown', email: 'mike@vhi.com', phone: '+2348045678901', industry: 'manufacturing', starRating: 2, status: 'lead', newsletterPrefs: [], isActive: false, createdAt: '2024-03-18T09:00:00Z' },
  { id: '5', userId: 'USR005', firstname: 'Lisa', lastname: 'Wang', email: 'lisa@vhi.com', phone: '+2348056789012', industry: 'mining', starRating: 4, status: 'returning', newsletterPrefs: [], isActive: true, createdAt: '2024-04-01T11:30:00Z' },
];

export default function AudienceSegmentation() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [segmentFilter, setSegmentFilter] = useState('');

  const filtered = mockCustomers.filter((c) => {
    if (search && !`${c.firstname} ${c.lastname} ${c.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (segmentFilter && c.industry !== segmentFilter) return false;
    return true;
  });

  const toggleRow = (id: string) => {
    const next = new Set(selectedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRows(next);
  };

  const toggleAll = () => {
    if (selectedRows.size === filtered.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(filtered.map((c) => c.id)));
  };

  return (
    <PageWrapper title="Audience Segmentation">
      <button onClick={() => navigate('/admin/newsletter')} className="btn-back">
        <ArrowLeft size={18} />
        Back to Newsletter
      </button>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input className="input" placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 280 }} />
        </div>
        <select className="select" value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)}>
          <option value="">All Segments</option>
          {industries.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
        </select>
        {selectedRows.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{selectedRows.size} selected</span>
            <select className="select">
              <option>Move to segment...</option>
              {industries.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
            <button className="btn btn-primary btn-sm">
              <Move size={14} />
              Move
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="vhi-table-container">
        <table className="vhi-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" className="toggle" style={{ width: 18, height: 18 }} checked={selectedRows.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
              </th>
              <th>Name</th>
              <th>Email</th>
              <th>Current Segment</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <input type="checkbox" className="toggle" style={{ width: 18, height: 18 }} checked={selectedRows.has(customer.id)} onChange={() => toggleRow(customer.id)} />
                </td>
                <td style={{ fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                      {customer.firstname[0]}{customer.lastname[0]}
                    </div>
                    {customer.firstname} {customer.lastname}
                  </div>
                </td>
                <td>{customer.email}</td>
                <td>
                  <select className="select" value={customer.industry} style={{ minWidth: 180 }}>
                    {industries.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                  </select>
                </td>
                <td><Badge status={customer.status} type="customer" size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageWrapper>
  );
}
