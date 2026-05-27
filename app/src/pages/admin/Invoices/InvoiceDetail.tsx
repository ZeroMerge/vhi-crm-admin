import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, AlarmClock } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import type { Invoice, Payment, InvoiceStatus } from '@/types';

const mockInvoice: Invoice = {
  id: '1', invoiceNumber: 'INV-2024-001', shipmentId: 'ship-1', customerId: '1',
  customer: { id: '1', userId: 'USR001', firstname: 'Jane', lastname: 'Smith', email: 'jane@vhi.com', phone: '+2348012345678', industry: 'oil_gas', starRating: 4, status: 'loyal', newsletterPrefs: [], isActive: true, createdAt: '2024-01-15T10:00:00Z' },
  shipment: { id: 'ship-1', orderId: '#1895-67-fw', customerId: '1', shippingMode: 'air_freight', deliveryMode: 'door_to_door', natureOfItem: 'Building material', invoiceValue: 34000000, invoiceCurrency: 'NGN', weight: 365000, weightUnit: 'kg', originAddress: 'London, UK', destinationAddress: 'Progue, Czech Republic', status: 'delivered', isDraft: false, createdAt: '2024-03-12T10:00:00Z', updatedAt: '2024-03-16T16:00:00Z' },
  amount: 34000000, currency: 'NGN', status: 'paid', dueDate: '2024-03-30', notes: 'Payment received in full', fileUrl: '/invoices/INV-2024-001.pdf',
  createdAt: '2024-03-15T10:00:00Z', updatedAt: '2024-03-15T14:00:00Z',
};

const mockPayments: Payment[] = [
  { id: '1', invoiceId: '1', customerId: '1', amount: 34000000, currency: 'NGN', paymentMethod: 'paystack', paymentStatus: 'success', gatewayReference: 'PSK-12345', receiptUrl: '/receipts/REC-001.pdf', paidAt: '2024-03-15T14:00:00Z', createdAt: '2024-03-15T14:00:00Z' },
];

const statusOptions: InvoiceStatus[] = ['draft', 'sent', 'pending', 'awaiting_vendor', 'part_paid', 'paid'];

export default function InvoiceDetail() {
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(mockInvoice);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('manual');
  const [paymentNotes, setPaymentNotes] = useState('');

  const isOverdue = new Date(invoice.dueDate) < new Date() && invoice.status !== 'paid';

  const handleRecordPayment = () => {
    setShowPaymentModal(false);
    setPaymentAmount('');
    setPaymentNotes('');
  };

  return (
    <PageWrapper>
      <button onClick={() => navigate('/admin/invoices')} className="btn-back">
        <ArrowLeft size={18} />
        Back to Invoices
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 'var(--font-size-4xl)', fontWeight: 400 }}>{invoice.invoiceNumber}</h1>
          <Badge status={invoice.status} type="invoice" />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-outline">
            <Download size={16} />
            Download PDF
          </button>
        </div>
      </div>

      {/* Overdue Alert */}
      {isOverdue && (
        <div className="alert-banner" style={{ marginBottom: 24, background: 'var(--color-status-pending-bg)' }}>
          <AlarmClock size={20} color="var(--color-status-pending-text)" />
          <span style={{ color: 'var(--color-status-pending-text)', fontWeight: 500 }}>
            This invoice is overdue. Due date was {formatDate(invoice.dueDate)}.
          </span>
        </div>
      )}

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Invoice Info */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Invoice Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Created</div>
                <div>{formatDate(invoice.createdAt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Due Date</div>
                <div>{formatDate(invoice.dueDate)}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Amount</div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 600, color: 'var(--color-primary)' }}>
                  {formatCurrency(invoice.amount, invoice.currency)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Currency</div>
                <div>{invoice.currency}</div>
              </div>
            </div>
            {invoice.notes && (
              <div style={{ marginTop: 16, padding: 12, background: 'var(--color-surface)', borderRadius: 'var(--border-radius-sm)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Notes</div>
                <div style={{ fontSize: 'var(--font-size-sm)' }}>{invoice.notes}</div>
              </div>
            )}
          </div>

          {/* Customer Info */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Customer</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                {invoice.customer?.firstname?.[0]}{invoice.customer?.lastname?.[0]}
              </div>
              <div>
                <div style={{ fontWeight: 500 }}>{invoice.customer?.firstname} {invoice.customer?.lastname}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{invoice.customer?.email}</div>
              </div>
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {invoice.customer?.phone}
            </div>
          </div>

          {/* Shipment Link */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Linked Shipment</h3>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Order ID</div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-lg)' }}>{invoice.shipment?.orderId}</div>
                <Badge status={invoice.shipment?.status || ''} type="shipment" size="sm" />
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => navigate(`/admin/shipments/${invoice.shipmentId}`)}>
                View Shipment
              </button>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Status Control */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>Status Control</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select
                className="select"
                value={invoice.status}
                onChange={(e) => setInvoice({ ...invoice, status: e.target.value as InvoiceStatus })}
                style={{ flex: 1 }}
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm">Update</button>
            </div>
          </div>

          {/* Record Payment */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Payments</h3>
              <button className="btn btn-primary btn-sm" onClick={() => setShowPaymentModal(true)}>
                Record Payment
              </button>
            </div>
            {mockPayments.length > 0 ? (
              <div className="vhi-table-container" style={{ border: 'none' }}>
                <table className="vhi-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Method</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockPayments.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(p.paidAt || p.createdAt)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(p.amount, p.currency)}</td>
                        <td style={{ textTransform: 'capitalize' }}>{p.paymentMethod}</td>
                        <td><Badge status={p.paymentStatus} type="invoice" size="sm" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                No payments recorded
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title="Record Payment"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setShowPaymentModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleRecordPayment}>Record Payment</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Amount</label>
            <input className="input" type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Enter amount..." />
          </div>
          <div className="form-group">
            <label className="form-label">Payment Method</label>
            <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={{ width: '100%' }}>
              <option value="manual">Manual/Cash</option>
              <option value="paystack">Paystack</option>
              <option value="stripe">Stripe</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="input" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Optional notes..." rows={3} style={{ borderRadius: 'var(--border-radius-md)', resize: 'vertical', width: '100%' }} />
          </div>
        </div>
      </Modal>
    </PageWrapper>
  );
}
