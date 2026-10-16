import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { customerService } from '@/services/customer.service';

// Filters that arrive from a report drill-down. The list pages pass them to the API unchanged and show them here as removable
// chips, so it is always visible why a list is narrower than usual. Local dates (APP_TIMEZONE), the same as the report.

const LABELS: Record<string, (v: string) => string> = {
  createdFrom: (v) => `Created from ${v}`,
  createdTo: (v) => `Created to ${v}`,
  dateField: (v) => (v === 'status_changed' ? 'Dated by when the status changed' : 'Dated by creation'),
  statusGroup: (v) => `Status group: ${v.replace(/_/g, ' ')}`,
  excludeDraft: () => 'Drafts excluded',
  industry: (v) => `Industry: ${v === 'none' ? 'not set' : v.replace(/_/g, ' ')}`,
  mode: (v) => `Mode: ${v.replace(/_/g, ' ')}`,
  issuedFrom: (v) => `Issued from ${v}`,
  issuedTo: (v) => `Issued to ${v}`,
  paidFrom: (v) => `Paid from ${v}`,
  paidTo: (v) => `Paid to ${v}`,
  hasOutstanding: () => 'Has an unpaid balance',
};

/** The drill-down parameters present in the URL, ready to spread into a list request. */
export function drillParams(params: URLSearchParams, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}

interface Props {
  keys: readonly string[];
  /** Resets the page counter when a chip is removed. */
  pageKey?: string;
}

export function DrillDownChips({ keys, pageKey = 'page' }: Props) {
  const [params, setParams] = useSearchParams();
  const [customerName, setCustomerName] = useState('');
  const customerId = params.get('customerId');
  const present = keys.filter((k) => params.get(k) && (LABELS[k] || k === 'customerId'));

  useEffect(() => {
    if (!customerId) return;
    let active = true;
    customerService.getById(customerId)
      .then((c) => { if (active) setCustomerName(`${c.firstname} ${c.lastname}`.trim()); })
      .catch(() => { if (active) setCustomerName('unknown customer'); });
    return () => { active = false; };
  }, [customerId]);

  if (present.length === 0) return null;

  const remove = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    // dateField only means something together with a date range
    if (key === 'createdFrom' || key === 'createdTo') if (!next.get('createdFrom') && !next.get('createdTo')) next.delete('dateField');
    next.set(pageKey, '1');
    setParams(next);
  };

  return (
    <div className="rpt" style={{ marginBottom: 16 }}>
      <div className="rpt-chips" role="group" aria-label="Filters from the report">
        <Link to="/admin/reports" className="btn btn-ghost btn-sm"><ArrowLeft size={14} aria-hidden="true" /> Back to reports</Link>
        {present.map((key) => {
          const value = params.get(key)!;
          const label = key === 'customerId' ? `Customer: ${customerName || '...'}` : LABELS[key](value);
          return (
            <span className="rpt-chip" key={key}>
              {label}
              <button type="button" aria-label={`Remove filter ${label}`} onClick={() => remove(key)}><X size={12} aria-hidden="true" /></button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
