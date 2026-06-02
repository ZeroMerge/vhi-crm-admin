import { useState, useEffect } from 'react';
import { ArrowLeft, Search, Move } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { customerService } from '@/services/customer.service';
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

export default function AudienceSegmentation() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [segmentFilter, setSegmentFilter] = useState('');
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        const response = await customerService.list({ pageSize: 1000 });
        if (active) {
          setCustomers(response.data);
        }
      } catch (err) {
        console.error('Failed to load customers:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchCustomers();
    return () => { active = false; };
  }, []);

  const filtered = customers.filter((c) => {
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
            {loading ? (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  Loading customers...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  No customers found matching criteria.
                </td>
              </tr>
            ) : (
              filtered.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <input type="checkbox" className="toggle" style={{ width: 18, height: 18 }} checked={selectedRows.has(customer.id)} onChange={() => toggleRow(customer.id)} />
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                        {customer.firstname[0]}{customer.lastname ? customer.lastname[0] : ''}
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageWrapper>
  );
}
