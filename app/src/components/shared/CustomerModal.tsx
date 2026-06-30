import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { customerService } from '@/services/customer.service';
import { CustomSelect } from '@/components/ui/CustomSelect';
import type { Customer } from '@/types';

interface CustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer?: Customer; // if provided, we edit. if not, we create.
  onSuccess: () => void;
}

export function CustomerModal({ isOpen, onClose, customer, onSuccess }: CustomerModalProps) {
  const [formData, setFormData] = useState<Partial<Customer>>({
    firstname: '',
    lastname: '',
    email: '',
    phone: '',
    industry: undefined,
    status: 'lead'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (customer) {
      setFormData({
        firstname: customer.firstname || '',
        lastname: customer.lastname || '',
        email: customer.email || '',
        phone: customer.phone || '',
        industry: customer.industry,
        status: customer.status || 'lead'
      });
    } else {
      setFormData({
        firstname: '',
        lastname: '',
        email: '',
        phone: '',
        industry: undefined,
        status: 'lead'
      });
    }
  }, [customer, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (customer) {
        await customerService.update(customer.id, formData);
      } else {
        await customerService.create(formData);
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ width: '100%', maxWidth: 500, padding: 0, overflow: 'visible' }}>
        <div className="modal-header">
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, margin: 0 }}>
            {customer ? 'Edit Customer' : 'New Customer'}
          </h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div style={{ padding: 12, background: 'var(--color-status-pending-bg)', color: 'var(--color-status-pending-text)', borderRadius: 'var(--radius-card)', marginBottom: 16 }}>{error}</div>}

          <form id="customer-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">First Name</label>
                <input required className="input" value={formData.firstname} onChange={e => setFormData({ ...formData, firstname: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">Last Name</label>
                <input required className="input" value={formData.lastname} onChange={e => setFormData({ ...formData, lastname: e.target.value })} />
              </div>
            </div>
            
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Email</label>
              <input required type="email" className="input" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Phone</label>
              <input required className="input" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">Industry</label>
                <CustomSelect
                  value={formData.industry || ''}
                  onChange={val => setFormData({ ...formData, industry: val as Customer['industry'] })}
                  options={[
                    { value: 'oil_gas', label: 'Oil & Gas' },
                    { value: 'medical', label: 'Medical' },
                    { value: 'pharma', label: 'Pharmaceutical' },
                    { value: 'agricultural', label: 'Agricultural' },
                    { value: 'manufacturing', label: 'Manufacturing' },
                    { value: 'mining', label: 'Mining' },
                    { value: 'others', label: 'Others' }
                  ]}
                />
              </div>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">Status</label>
                <CustomSelect
                  value={formData.status || ''}
                  onChange={val => setFormData({ ...formData, status: val as Customer['status'] })}
                  options={[
                    { value: 'lead', label: 'Lead' },
                    { value: 'prospect', label: 'Prospect' },
                    { value: 'returning', label: 'Returning' },
                    { value: 'loyal', label: 'Loyal' }
                  ]}
                />
              </div>
            </div>
          </form>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" form="customer-form" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : 'Save Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}
