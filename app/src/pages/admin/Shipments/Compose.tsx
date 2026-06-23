import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, AlertCircle, Search,
  Package, MapPin, Truck, FileText, X,
} from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { shipmentService } from '@/services/shipment.service';
import { customerService } from '@/services/customer.service';
import type { Customer } from '@/types';


const STEPS = [
  { id: 1, label: 'Customer',  icon: FileText  },
  { id: 2, label: 'Shipment',  icon: Package   },
  { id: 3, label: 'Route',     icon: MapPin    },
  { id: 4, label: 'Logistics', icon: Truck     },
];

const SHIPPING_MODES = [
  { value: 'air_freight',    label: 'Air Freight'       },
  { value: 'groupage',       label: 'Groupage'          },
  { value: 'consolidation',  label: 'Consolidation'     },
  { value: 'china_groupage', label: 'China Groupage'    },
  { value: 'cargo_clearing', label: 'Cargo Clearing'    },
  { value: 'export',         label: 'Export'            },
];

const DELIVERY_MODES = [
  { value: 'door_to_door',     label: 'Door to Door'     },
  { value: 'port_to_port',     label: 'Port to Port'     },
  { value: 'port_to_door',     label: 'Port to Door'     },
  { value: 'clearance_only',   label: 'Clearance Only'   },
  { value: 'office_pickup',    label: 'Office Pickup'    },
  { value: 'airport_pickup',   label: 'Airport Pickup'   },
];

const WEIGHT_UNITS = [
  { value: 'kg',  label: 'KG'  },
  { value: 'lbs', label: 'LBS' },
  { value: 'cbm', label: 'CBM' },
];

const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'];


const emptyForm = {
  customerId:          '',
  shippingMode:        'air_freight',
  deliveryMode:        'door_to_door',
  natureOfItem:        '',
  hsCode:              '',
  invoiceValue:        '',
  invoiceCurrency:     'NGN',
  weight:              '',
  weightUnit:          'kg',
  originAddress:       '',
  destinationAddress:  '',
  originPickupOption:  'vhi_pickup',
  portOfDischarge:     '',
  awbNumber:           '',
  bolNumber:           '',
  uniqueId:            '',
  status:              'pending',
  isDraft:             false,
};

type FormState = typeof emptyForm;


function validate(step: number, form: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    if (!form.customerId) e.customerId = 'Select a customer';
  }
  if (step === 2) {
    if (!form.natureOfItem.trim()) e.natureOfItem = 'Required';
    if (!form.invoiceValue || isNaN(Number(form.invoiceValue)) || Number(form.invoiceValue) < 0)
      e.invoiceValue = 'Enter a valid invoice value';
    if (!form.weight || isNaN(Number(form.weight)) || Number(form.weight) <= 0)
      e.weight = 'Enter a valid weight';
  }
  if (step === 3) {
    if (!form.originAddress.trim()) e.originAddress = 'Required';
    if (!form.destinationAddress.trim()) e.destinationAddress = 'Required';
  }
  return e;
}


function Field({
  label, required, error, children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
        {label}{required && <span style={{ color: 'var(--color-danger)', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error && (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertCircle size={12} /> {error}
        </span>
      )}
    </div>
  );
}


function CustomerPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
  error?: string;
}) {
  const [query, setQuery]               = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [results, setResults]           = useState<Customer[]>([]);
  const [open, setOpen]                 = useState(false);
  const [loading, setLoading]           = useState(false);
  const ref                             = useRef<HTMLDivElement>(null);

  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  
  useEffect(() => {
    if (!query || query.length < 2) { 
      const timer = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(timer);
    }
    let active = true;
    setTimeout(() => { if (active) setLoading(true); }, 0);
    customerService.list({ search: query, pageSize: 8 })
      .then((r) => { if (active) setResults(r.data); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);

  const pick = (c: Customer) => {
    const name = `${c.firstname} ${c.lastname}`;
    setSelectedName(name);
    setQuery('');
    setOpen(false);
    onChange(c.id, name);
  };

  const clear = () => {
    setSelectedName('');
    setQuery('');
    onChange('', '');
  };

  return (
    <Field label="Customer" required error={error}>
      <div ref={ref} style={{ position: 'relative' }}>
        {value && selectedName ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px',
            border: '1.5px solid var(--color-primary)',
            borderRadius: 'var(--radius-input)',
            background: 'var(--color-primary-light)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 500,
          }}>
            <span>{selectedName}</span>
            <button onClick={clear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0 }}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
            <input
              className="input"
              style={{ paddingLeft: 38 }}
              placeholder="Search customer by name or email…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
            />
          </div>
        )}

        {open && !value && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: 'white', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-dropdown)',
            marginTop: 4, maxHeight: 260, overflowY: 'auto',
          }}>
            {loading && (
              <div style={{ padding: '12px 16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                Searching…
              </div>
            )}
            {!loading && results.length === 0 && query.length >= 2 && (
              <div style={{ padding: '12px 16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                No customers found
              </div>
            )}
            {!loading && query.length < 2 && (
              <div style={{ padding: '12px 16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                Type at least 2 characters to search
              </div>
            )}
            {results.map((c) => (
              <button
                key={c.id}
                onClick={() => pick(c)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 16px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 2,
                  borderBottom: '1px solid var(--color-border)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {c.firstname} {c.lastname}
                </span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {c.email} · {c.industry?.replace(/_/g, ' ')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ComposeShipment() {
  const navigate  = useNavigate();
  const [step, setStep]       = useState(1);
  const [form, setForm]       = useState<FormState>(emptyForm);
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const set = (key: keyof FormState, val: unknown) =>
    setForm((f) => ({ ...f, [key]: val }));

  const next = () => {
    const e = validate(step, form);
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setStep((s) => Math.min(s + 1, STEPS.length));
  };

  const back = () => { setErrors({}); setStep((s) => Math.max(s - 1, 1)); };

  const handleSave = async (draft = false) => {
    const e = validate(step, form);
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    setSaveErr('');
    try {
      const payload = {
        ...form,
        invoiceValue: Number(form.invoiceValue) || 0,
        weight:       Number(form.weight)       || 0,
        isDraft:      draft,
        status:       draft ? 'draft' : form.status,
      };
      const shipment = await shipmentService.create(payload as Record<string, unknown>);
      navigate(`/admin/shipments/${shipment.id}`);
    } catch (err: any) {
      setSaveErr(err?.response?.data?.message || 'Failed to create shipment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Step Panels ─────────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      // ── Step 1: Customer ──
      case 1:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <CustomerPicker
              value={form.customerId}
              error={errors.customerId}
              onChange={(id) => set('customerId', id)}
            />
            <Field label="Initial Status">
              <CustomSelect
                value={form.status}
                onChange={(val) => set('status', val)}
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'processing', label: 'Processing' },
                  { value: 'in_transit', label: 'In Transit' },
                  { value: 'clearance', label: 'Clearance' }
                ]}
                width="100%"
              />
            </Field>
          </div>
        );

      // ── Step 2: Shipment Details ──
      case 2:
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="compose-grid">
            <Field label="Shipping Mode" required>
              <CustomSelect
                value={form.shippingMode}
                onChange={(val) => set('shippingMode', val)}
                options={SHIPPING_MODES}
                width="100%"
              />
            </Field>

            <Field label="Delivery Mode" required>
              <CustomSelect
                value={form.deliveryMode}
                onChange={(val) => set('deliveryMode', val)}
                options={DELIVERY_MODES}
                width="100%"
              />
            </Field>

            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Nature of Item" required error={errors.natureOfItem}>
                <input
                  className="input"
                  placeholder="e.g. Building materials, Medical equipment"
                  value={form.natureOfItem}
                  onChange={(e) => set('natureOfItem', e.target.value)}
                />
              </Field>
            </div>

            <Field label="HS Code">
              <input
                className="input"
                placeholder="e.g. 392690"
                value={form.hsCode}
                onChange={(e) => set('hsCode', e.target.value)}
              />
            </Field>

            <Field label="Weight" required error={errors.weight}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={form.weight}
                  onChange={(e) => set('weight', e.target.value)}
                  style={{ flex: 1 }}
                />
                <CustomSelect
                  value={form.weightUnit}
                  onChange={(val) => set('weightUnit', val)}
                  options={WEIGHT_UNITS}
                  width={90}
                />
              </div>
            </Field>

            <Field label="Invoice Value" required error={errors.invoiceValue}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder="0.00"
                  value={form.invoiceValue}
                  onChange={(e) => set('invoiceValue', e.target.value)}
                  style={{ flex: 1 }}
                />
                <CustomSelect
                  value={form.invoiceCurrency}
                  onChange={(val) => set('invoiceCurrency', val)}
                  options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                  width={90}
                />
              </div>
            </Field>
          </div>
        );

      // ── Step 3: Route ──
      case 3:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Field label="Origin Address" required error={errors.originAddress}>
              <textarea
                className="input"
                rows={3}
                placeholder="Full pickup / collection address"
                value={form.originAddress}
                onChange={(e) => set('originAddress', e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </Field>

            <Field label="Pickup Option">
              <CustomSelect
                value={form.originPickupOption}
                onChange={(val) => set('originPickupOption', val)}
                options={[
                  { value: 'vhi_pickup', label: 'VHI Pickup' },
                  { value: 'supplier_dropoff', label: 'Supplier Drop-off' }
                ]}
                width="100%"
              />
            </Field>

            <Field label="Destination Address" required error={errors.destinationAddress}>
              <textarea
                className="input"
                rows={3}
                placeholder="Full delivery address"
                value={form.destinationAddress}
                onChange={(e) => set('destinationAddress', e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </Field>

            <Field label="Port of Discharge">
              <input
                className="input"
                placeholder="e.g. Apapa Port, Tin Can Island"
                value={form.portOfDischarge}
                onChange={(e) => set('portOfDischarge', e.target.value)}
              />
            </Field>
          </div>
        );

      // ── Step 4: Logistics / Reference Numbers ──
      case 4:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 4, lineHeight: 1.6 }}>
              Reference numbers are optional at creation — you can update them later from the shipment detail page.
            </p>

            <Field label="AWB Number (Air Waybill)">
              <input
                className="input"
                placeholder="e.g. 157-12345678"
                value={form.awbNumber}
                onChange={(e) => set('awbNumber', e.target.value)}
              />
            </Field>

            <Field label="BoL Number (Bill of Lading)">
              <input
                className="input"
                placeholder="e.g. MSCUXXX123456"
                value={form.bolNumber}
                onChange={(e) => set('bolNumber', e.target.value)}
              />
            </Field>

            <Field label="Unique Shipment ID">
              <input
                className="input"
                placeholder="Internal reference / tracking code"
                value={form.uniqueId}
                onChange={(e) => set('uniqueId', e.target.value)}
              />
            </Field>

            {saveErr && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                background: '#fef2f2', border: '1px solid #fca5a5',
                borderRadius: 'var(--radius-card)',
                fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)',
              }}>
                <AlertCircle size={16} />
                {saveErr}
              </div>
            )}
          </div>
        );

      default: return null;
    }
  };

  return (
    <PageWrapper title="New Shipment">
      {/* Back button */}
      <button onClick={() => navigate('/admin/shipments')} className="btn-back" style={{ marginBottom: 24 }}>
        <ArrowLeft size={18} />
        Back to Shipments
      </button>

      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 'var(--font-size-3xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
          Create New Shipment
        </h1>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Fill in the shipment details below. All starred fields are required.
        </p>
      </div>

      {/* Step Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 40, overflowX: 'auto', gap: 0 }}>
        {STEPS.map((s, idx) => {
          const done    = step > s.id;
          const active  = step === s.id;
          const IconCmp = s.icon;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: idx < STEPS.length - 1 ? 1 : 'none' }}>
              {/* Step bubble */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: done ? 'var(--color-primary)' : active ? 'var(--color-primary)' : 'var(--color-surface)',
                  border: `2px solid ${done || active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: done || active ? 'white' : 'var(--color-text-muted)',
                  transition: 'all 0.2s ease',
                }}>
                  {done ? <Check size={18} strokeWidth={2.5} /> : <IconCmp size={18} />}
                </div>
                <span style={{
                  fontSize: 'var(--font-size-xs)', fontWeight: active ? 700 : 400,
                  color: active ? 'var(--color-primary)' : done ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                }}>
                  {s.label}
                </span>
              </div>
              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 2, margin: '0 8px', marginBottom: 22,
                  background: step > s.id ? 'var(--color-primary)' : 'var(--color-border)',
                  transition: 'background 0.2s ease',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Form card */}
      <div className="card" style={{ maxWidth: 780, padding: '36px 40px' }} id="compose-shipment-card">
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 28 }}>
          {STEPS[step - 1].label}
        </h2>

        {renderStep()}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, gap: 12 }}>
          <div>
            {step > 1 && (
              <button className="btn btn-outline" onClick={back} disabled={saving}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            {step === STEPS.length ? (
              <>
                <button
                  className="btn btn-outline"
                  onClick={() => handleSave(true)}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save as Draft'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => handleSave(false)}
                  disabled={saving}
                >
                  {saving ? 'Creating…' : 'Create Shipment'}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={next}>
                Continue <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile single-column override is handled by globals.css .compose-grid */}
    </PageWrapper>
  );
}
