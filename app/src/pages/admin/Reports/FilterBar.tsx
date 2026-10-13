import { useEffect, useId, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { customerService } from '@/services/customer.service';
import { reportService } from '@/services/report.service';
import type { Granularity, RangePreset, ReportFilterParams, ReportMeta } from '@/services/report.service';
import { humanize, prettyRange } from './format';

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];
const GRANULARITY_LABELS: Record<Granularity, string> = { day: 'Day', week: 'Week (Mon-Sun)', month: 'Month', year: 'Year' };
const GROUP_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

type Patch = Partial<Record<keyof ReportFilterParams, string | undefined>>;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    onChange();
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Searchable customer picker (ARIA combobox). Only ids and names are fetched. */
function CustomerPicker({ id: inputId, value, name, onPick }: { id: string; value?: string; name: string; onPick: (id: string | undefined) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      reportService.customerOptions(text, controller.signal)
        .then((rows) => { setOptions(rows); setActive(-1); setFailed(false); })
        .catch((err) => { if (err?.code !== 'ERR_CANCELED') setFailed(true); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, open]);

  const choose = (opt: { id: string; name: string } | null) => {
    onPick(opt?.id);
    setText('');
    setOpen(false);
  };

  return (
    <div className="rpt-combo">
      <input
        className="rpt-input"
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
        placeholder={value ? name || 'Selected customer' : 'All customers'}
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, options.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && active >= 0 && options[active]) { e.preventDefault(); choose(options[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="rpt-combo-list" role="listbox" id={`${id}-list`} aria-label="Customers">
          {failed && <li className="rpt-state" role="alert">Could not load customers</li>}
          {!failed && options.length === 0 && <li className="rpt-state">No customers found</li>}
          {options.map((o, i) => (
            <li key={o.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); choose(o); }}>
              {o.name || 'Unnamed'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="rpt-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="rpt-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

interface Props {
  meta: ReportMeta;
  filters: ReportFilterParams;
  resolved?: { from: string; to: string; granularity: Granularity; timezone: string };
  onChange: (patch: Patch) => void;
  onReset: () => void;
}

export function FilterBar({ meta, filters, resolved, onChange, onReset }: Props) {
  const uid = useId();
  const mobile = useMediaQuery('(max-width: 768px)');
  const [sheet, setSheet] = useState(false);
  // The chip needs the name of the customer in the URL; one small lookup per id. The name is kept with its id, so a stale name is never shown.
  const [lookup, setLookup] = useState<{ id: string; name: string } | null>(null);
  const customerName = lookup && lookup.id === filters.customerId ? lookup.name : '';
  useEffect(() => {
    const id = filters.customerId;
    if (!id) return;
    let active = true;
    customerService.getById(id)
      .then((c) => { if (active) setLookup({ id, name: `${c.firstname} ${c.lastname}`.trim() }); })
      .catch(() => { if (active) setLookup({ id, name: 'Unknown customer' }); });
    return () => { active = false; };
  }, [filters.customerId]);

  const showCurrency = meta.capabilities.revenue && meta.currencies.length > 1;
  const range = filters.range ?? 'this_month';
  const shown = resolved ?? meta.presets[range];

  const chips: Array<{ key: string; label: string; clear: Patch }> = [];
  if (filters.customerId) chips.push({ key: 'customer', label: `Customer: ${customerName || '...'}`, clear: { customerId: undefined } });
  if (filters.industry) chips.push({ key: 'industry', label: `Industry: ${humanize(filters.industry === 'none' ? null : filters.industry)}`, clear: { industry: undefined } });
  if (filters.statusGroup) chips.push({ key: 'group', label: `Status: ${GROUP_LABELS[filters.statusGroup] ?? filters.statusGroup}`, clear: { statusGroup: undefined } });
  if (filters.mode) chips.push({ key: 'mode', label: `Mode: ${humanize(filters.mode)}`, clear: { mode: undefined } });
  if (filters.currency) chips.push({ key: 'currency', label: `Currency: ${filters.currency}`, clear: { currency: undefined } });
  if (filters.granularity) chips.push({ key: 'granularity', label: `Per ${filters.granularity}`, clear: { granularity: undefined } });

  const fields = (
    <>
      <div className="rpt-field">
        <label htmlFor={`${uid}-customer`}>Customer</label>
        <CustomerPicker id={`${uid}-customer`} value={filters.customerId} name={customerName} onPick={(id) => onChange({ customerId: id })} />
      </div>
      <Select id={`${uid}-industry`} label="Industry" value={filters.industry ?? ''} onChange={(v) => onChange({ industry: v || undefined })}
        options={[{ value: '', label: 'All industries' }, ...meta.industries.map((i) => ({ value: i, label: humanize(i) })), { value: 'none', label: 'Not set' }]} />
      <Select id={`${uid}-group`} label="Shipment status" value={filters.statusGroup ?? ''} onChange={(v) => onChange({ statusGroup: v || undefined })}
        options={[{ value: '', label: 'All statuses' }, ...meta.statusGroups.map((g) => ({ value: g, label: GROUP_LABELS[g] ?? g }))]} />
      <Select id={`${uid}-mode`} label="Shipping mode" value={filters.mode ?? ''} onChange={(v) => onChange({ mode: v || undefined })}
        options={[{ value: '', label: 'All modes' }, ...meta.modes.map((m) => ({ value: m, label: humanize(m) }))]} />
      {showCurrency && (
        <Select id={`${uid}-currency`} label="Currency" value={filters.currency ?? ''} onChange={(v) => onChange({ currency: v || undefined })}
          options={[{ value: '', label: 'All currencies' }, ...meta.currencies.map((c) => ({ value: c, label: c }))]} />
      )}
      <Select id={`${uid}-gran`} label="Period" value={filters.granularity ?? ''} onChange={(v) => onChange({ granularity: (v || undefined) as string | undefined })}
        options={[{ value: '', label: `Automatic${resolved ? ` (${GRANULARITY_LABELS[resolved.granularity]})` : ''}` }, ...meta.granularities.map((g) => ({ value: g, label: GRANULARITY_LABELS[g] }))]} />
    </>
  );

  return (
    <section className="rpt-filters" aria-label="Report filters">
      <div className="rpt-filters-row">
        <div className="rpt-seg" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" aria-pressed={range === p.value}
              onClick={() => onChange(p.value === 'custom' ? { range: 'custom', from: filters.from ?? shown?.from, to: filters.to ?? shown?.to } : { range: p.value })}>
              {p.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <>
            <div className="rpt-field" style={{ minWidth: 140 }}>
              <label htmlFor={`${uid}-from`}>From</label>
              <input id={`${uid}-from`} type="date" className="rpt-input" value={filters.from ?? ''} max={filters.to || undefined} onChange={(e) => e.target.value && onChange({ from: e.target.value })} />
            </div>
            <div className="rpt-field" style={{ minWidth: 140 }}>
              <label htmlFor={`${uid}-to`}>To</label>
              <input id={`${uid}-to`} type="date" className="rpt-input" value={filters.to ?? ''} min={filters.from || undefined} onChange={(e) => e.target.value && onChange({ to: e.target.value })} />
            </div>
          </>
        )}
        {mobile && (
          <button type="button" className="btn btn-outline btn-sm rpt-filter-toggle" onClick={() => setSheet(true)}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filters{chips.length ? ` (${chips.length})` : ''}
          </button>
        )}
      </div>
      {!mobile && <div className="rpt-filters-row">{fields}</div>}
      <p className="rpt-sub" aria-live="polite">
        {shown ? <>Showing <strong>{prettyRange(shown.from, shown.to)}</strong>{resolved ? ` (${resolved.timezone})` : ''}.</> : null}
      </p>
      {chips.length > 0 && (
        <div className="rpt-chips">
          {chips.map((c) => (
            <span className="rpt-chip" key={c.key}>
              {c.label}
              <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => onChange(c.clear)}><X size={12} aria-hidden="true" /></button>
            </span>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>Reset all</button>
        </div>
      )}
      {mobile && (
        <Modal isOpen={sheet} onClose={() => setSheet(false)} title="Filters" maxWidth="520px"
          footer={<button type="button" className="btn btn-primary btn-md btn-full" onClick={() => setSheet(false)}>Done</button>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} className="rpt">{fields}</div>
        </Modal>
      )}
    </section>
  );
}
