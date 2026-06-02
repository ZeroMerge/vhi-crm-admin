import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { Badge } from '@/components/ui/Badge';
import { StarRating } from '@/components/ui/StarRating';
import { formatDate } from '@/utils/formatDate';
import { formatCurrency } from '@/utils/formatCurrency';
import { customerService } from '@/services/customer.service';
import type { Customer, Shipment, Payment, Communication } from '@/types';

const mockMessages: Communication[] = [
  { id: '1', customerId: '1', sentBy: 'admin-1', subject: 'Shipment Update', body: 'Your shipment has been delivered successfully.', isRead: true, createdAt: '2024-03-15T14:00:00Z' },
  { id: '2', customerId: '1', sentBy: 'admin-1', subject: 'Invoice Reminder', body: 'Please find attached your invoice for the recent shipment.', isRead: false, createdAt: '2024-04-10T09:00:00Z' },
];

type TabType = 'shipments' | 'payments' | 'messages';

export default function CustomerDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<TabType>('shipments');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [starRating, setStarRating] = useState(0);
  const [customerStatus, setCustomerStatus] = useState<Customer['status']>('loyal');
  const [showCompose, setShowCompose] = useState(false);
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');

  const tabs: { label: string; value: TabType }[] = [
    { label: 'Shipments', value: 'shipments' },
    { label: 'Payments', value: 'payments' },
    { label: 'Messages', value: 'messages' },
  ];

  useEffect(() => {
    if (!id) return;

    let active = true;

    const fetchCustomer = async () => {
      setLoading(true);
      try {
        const [customerData, shipmentData, paymentData] = await Promise.all([
          customerService.getById(id),
          customerService.getShipments(id),
          customerService.getPayments(id),
        ]);

        if (!active) return;

        setCustomer(customerData);
        setShipments(shipmentData);
        setPayments(paymentData);
        setStarRating(customerData.starRating);
        setCustomerStatus(customerData.status);
      } catch (err) {
        console.error('Failed to load customer detail:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchCustomer();

    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <PageWrapper>
        <div className="card animate-pulse" style={{ height: 280, background: 'var(--color-surface)' }} />
      </PageWrapper>
    );
  }

  if (!customer) {
    return (
      <PageWrapper>
        <button onClick={() => navigate('/admin/customers')} className="btn-back">
          <ArrowLeft size={18} />
          Back to Customers
        </button>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          Customer not found.
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <button onClick={() => navigate('/admin/customers')} className="btn-back">
        <ArrowLeft size={18} />
        Back to Customers
      </button>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="two-col-layout" style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--color-primary-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-primary)',
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {customer.firstname[0]}{customer.lastname[0]}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 600 }}>
                {customer.firstname} {customer.lastname}
              </h1>
              <Badge status={customerStatus} type="customer" />
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              User ID: {customer.userId} · Joined {formatDate(customer.createdAt)}
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 'var(--font-size-sm)', flexWrap: 'wrap' }}>
              <span>{customer.email}</span>
              <span>{customer.phone}</span>
              <span><Badge status={customer.industry} type="shipment" size="sm" /></span>
            </div>
          </div>

          <div className="col-right" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Star Rating:</span>
              <StarRating value={starRating} onChange={setStarRating} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Status:</span>
              <select
                className="select"
                value={customerStatus}
                onChange={(e) => setCustomerStatus(e.target.value as Customer['status'])}
                style={{ minWidth: 140 }}
              >
                <option value="lead">Lead</option>
                <option value="prospect">Prospect</option>
                <option value="returning">Returning</option>
                <option value="loyal">Loyal</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 className="card-title" style={{ marginBottom: 16 }}>Financial Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 8 }}>Total Cleared</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {formatCurrency(customer.totalPaid || 0, 'NGN')}
            </div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 8 }}>Outstanding Balance</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-primary)' }}>
              {formatCurrency(customer.outstandingBalance || 0, 'NGN')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: '10px 20px',
              borderBottom: activeTab === tab.value ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === tab.value ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontWeight: activeTab === tab.value ? 600 : 400,
              fontSize: 'var(--font-size-sm)',
              background: 'none',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab.value ? 'var(--color-primary)' : 'transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'shipments' && (
        <div className="vhi-table-container">
          <table className="vhi-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Date</th>
                <th>Weight</th>
                <th style={{ textAlign: 'right' }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{s.orderId}</td>
                  <td><Badge status={s.shippingMode} type="shipment" size="sm" /></td>
                  <td><Badge status={s.status} type="shipment" size="sm" /></td>
                  <td>{formatDate(s.createdAt)}</td>
                  <td>{s.weight.toLocaleString()}{s.weightUnit}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(s.invoiceValue, s.invoiceCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="vhi-table-container">
          <table className="vhi-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice No</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{p.invoiceId}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(p.amount, p.currency)}</td>
                  <td><Badge status={p.paymentStatus} type="invoice" size="sm" /></td>
                  <td style={{ textTransform: 'capitalize' }}>{p.paymentMethod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'messages' && (
        <div>
          <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={() => setShowCompose(!showCompose)}>
            {showCompose ? 'Cancel' : 'Compose Message'}
          </button>

          {showCompose && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="input" value={messageSubject} onChange={(e) => setMessageSubject(e.target.value)} placeholder="Enter subject..." />
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <textarea
                  className="input"
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder="Type your message..."
                  rows={4}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <button className="btn btn-primary btn-sm">Send Message</button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mockMessages.map((msg) => (
              <div key={msg.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{msg.subject}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{formatDate(msg.createdAt)}</span>
                </div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{msg.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
